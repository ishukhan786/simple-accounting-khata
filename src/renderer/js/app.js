/**
 * Simple Khata - Offline Desktop Accounting Application
 * Client-Side Application Controller
 */

// Global App State
const state = {
  currentUser: { id: 1, name: 'Admin', role: 'Admin' },
  currentCustomer: null, // Active customer for khata view
  activeView: 'dashboard',
  customers: [],
  settings: {},
  activeModal: null,
  transactionCustomerId: null,
  pendingConfirmAction: null
};

// --- Formatters & Helpers ---

function debounce(func, wait = 180) {
  let timeout;
  return function (...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), wait);
  };
}

function formatMoney(cents, currency = '', forceInteger = false) {
  const absCents = Math.abs(parseInt(cents, 10) || 0);
  
  if (forceInteger) {
    const intPart = Math.round(absCents / 100);
    const formattedNum = intPart.toLocaleString('en-US');
    return currency ? `${currency} ${formattedNum}` : formattedNum;
  }
  
  const intPart = Math.floor(absCents / 100);
  const decPart = String(absCents % 100).padStart(2, '0');
  
  let formattedNum = intPart.toLocaleString('en-US');
  if (decPart !== '00') {
    formattedNum += `.${decPart}`;
  }
  
  return currency ? `${currency} ${formattedNum}` : formattedNum;
}

function parseAmountToCents(amountStr) {
  if (!amountStr) return 0;
  const cleaned = String(amountStr).replace(/,/g, '').trim();
  const num = parseFloat(cleaned);
  if (isNaN(num)) return 0;
  return Math.round(num * 100);
}

function formatDate(dateStr) {
  if (!dateStr) return '—';
  // If YYYY-MM-DD
  const parts = dateStr.split('T')[0].split('-');
  if (parts.length === 3) {
    return `${parts[2]}-${parts[1]}-${parts[0]}`;
  }
  return dateStr;
}

function listLine(text, isPrimary = false, isMuted = false) {
  if (text === undefined || text === null || text === '') return '';
  const cls = isPrimary ? 'style="font-weight:600; color:var(--text-main);"' : isMuted ? 'style="font-size:0.8rem; color:var(--text-muted); display:block;"' : 'style="display:block;"';
  return `<div ${cls}>${escapeHtml(String(text))}</div>`;
}

function shortBalanceLabel(status) {
  if (status === 'Receivable') return 'Lena hai';
  if (status === 'Payable') return 'Dena hai';
  return 'Barabar';
}

function showToast(message, type = 'success') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `
    <span>${type === 'success' ? '✓' : '⚠'}</span>
    <span>${escapeHtml(message)}</span>
  `;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

// --- IPC / API Connector (Electron Bridge or Web Fallback) ---

const khataApi = window.api || {
  getSession: () => khataApi.call('get-session'),
  logout: () => khataApi.call('logout'),
  getTransactionById: id => khataApi.call('get-transaction-by-id', { id }),
  getBackupStatus: () => khataApi.call('backup-status'),
  changePassword: (currentPassword, newPassword, user) => khataApi.call('change-password', { currentPassword, newPassword, user }),
  // Web fallback implementation if tested in browser
  async call(endpoint, data = {}) {
    const res = await fetch(`/api/${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    const json = await res.json();
    if (!json.success && json.error) throw new Error(json.error);
    return json.data;
  },
  getDashboardData: () => khataApi.call('dashboard-data'),
  getCustomers: (search, includeArchived) => khataApi.call('get-customers', { search, includeArchived }),
  getCustomerById: (id) => khataApi.call('get-customer-by-id', { id }),
  peekNextAccountCode: () => khataApi.call('peek-account-code'),
  createCustomer: (data, user) => khataApi.call('create-customer', { data, user }),
  updateCustomer: (id, data, user) => khataApi.call('update-customer', { id, data, user }),
  archiveCustomer: (id, user) => khataApi.call('archive-customer', { id, user }),
  deleteCustomer: (id, user) => khataApi.call('delete-customer', { id, user }),
  getCustomerLedger: (id, sort, from, to) => khataApi.call('get-customer-ledger', { id, sort, from, to }),
  createTransaction: (data, user) => khataApi.call('create-transaction', { data, user }),
  updateTransaction: (id, data, user) => khataApi.call('update-transaction', { id, data, user }),
  deleteTransaction: (id, user) => khataApi.call('delete-transaction', { id, user }),
  getAllTransactions: (filters) => khataApi.call('get-all-transactions', { filters }),
  getReceipt: (trxId) => khataApi.call('get-receipt', { trxId }),
  getCustomerNotes: (customerId) => khataApi.call('get-customer-notes', { customerId }),
  addCustomerNote: (customerId, note, user) => khataApi.call('add-customer-note', { customerId, note, user }),
  getSettings: () => khataApi.call('get-settings'),
  updateSettings: (data, user) => khataApi.call('update-settings', { data, user }),
  getBackups: () => khataApi.call('get-backups'),
  createBackup: (user) => khataApi.call('create-backup', { user }),
  restoreBackup: (filepath, user) => khataApi.call('restore-backup', { filepath, user }),
  pickRestoreFile: () => khataApi.call('pick-restore-file'),
  getUsers: () => khataApi.call('get-users'),
  createUser: (name, username, password, role, user) => khataApi.call('create-user', { name, username, password, role, user }),
  deleteUser: (id, user) => khataApi.call('delete-user', { id, user }),
  getAuditLogs: (limit) => khataApi.call('get-audit-logs', { limit }),
  getCustomerBalanceReport: (currency) => khataApi.call('report-balance', { currency }),
  getReceivableReport: (currency) => khataApi.call('report-receivable', { currency }),
  getPayableReport: (currency) => khataApi.call('report-payable', { currency }),
  authenticate: (username, password) => khataApi.call('authenticate', { username, password })
};

// --- Application Navigation ---

function navigateTo(viewName) {
  if (!allowLeaveForms()) return;
  state.activeView = viewName;

  // Update sidebar active class
  document.querySelectorAll('.nav-item').forEach(el => {
    el.classList.toggle('active', el.getAttribute('data-view') === viewName);
  });

  // Hide all sections, show active
  document.querySelectorAll('.view-section').forEach(sec => {
    sec.classList.remove('active-view');
  });

  const targetSection = document.getElementById(`view-${viewName}`);
  if (targetSection) targetSection.classList.add('active-view');

  // Update Topbar Title
  const titles = {
    dashboard: 'Dashboard',
    customers: 'Customers',
    'customer-khata': 'Customer Khata Ledger',
    transactions: 'All Transactions',
    reports: 'Financial & Ledger Reports',
    backup: 'Backup & Restore',
    settings: 'Settings & Profile'
  };
  document.getElementById('page-title').textContent = titles[viewName] || 'Simple Khata';

  // Load View Data
  if (viewName === 'dashboard') loadDashboard();
  else if (viewName === 'customers') loadCustomers();
  else if (viewName === 'transactions') { loadTransactionCustomers(); loadTransactions(); }
  else if (viewName === 'reports') loadReports();
  else if (viewName === 'backup') loadBackups();
  else if (viewName === 'settings') loadSettings();
}

// --- Modal Management ---

function openModal(modalId) {
  const modal = document.getElementById(modalId);
  if (!modal) return;
  if (state.activeModal && state.activeModal !== modalId && state.activeModal !== 'modal-app-login') {
    if (!allowDiscard(state.activeModal)) return;
    closeModal(state.activeModal, true);
  }
  modal.classList.add('active-modal');
  state.activeModal = modalId;
  rememberForm(modalId);

  // Auto focus first input
  const input = modal.querySelector('input:not([readonly]), select, textarea');
  if (input) setTimeout(() => input.focus(), 50);
}

function closeModal(modalId, saved = false) {
  const id = modalId || state.activeModal;
  if (!id) return;
  if (id === 'modal-app-login' && !state.currentUser) return;
  if (!saved && ((id === 'modal-new-transaction' && state.savingTransaction) || (id === 'modal-new-customer' && state.savingCustomer))) return;
  if (!saved && !allowDiscard(id)) return;
  const modal = document.getElementById(id);
  if (modal) modal.classList.remove('active-modal');
  if (state.activeModal === id) state.activeModal = null;
  formSnapshots.delete(id);
}

function openConfirmDialog(title, message, onConfirm) {
  document.getElementById('confirm-modal-title').textContent = title;
  document.getElementById('confirm-modal-message').textContent = message;
  state.pendingConfirmAction = onConfirm;
  openModal('modal-confirm');
}

// --- 1. Dashboard View Logic ---

async function loadDashboard() {
  try {
    const data = await khataApi.getDashboardData();

    document.getElementById('metric-total-customers').textContent = data.total_customers;
    document.getElementById('metric-today-transactions').textContent = data.today_transactions_count;

    // AED Card
    document.getElementById('dash-aed-receivable').textContent = formatMoney(data.aed_summary.receivable_cents, 'AED');
    document.getElementById('dash-aed-payable').textContent = formatMoney(data.aed_summary.payable_cents, 'AED');
    document.getElementById('dash-aed-received').textContent = formatMoney(data.aed_summary.today_received_cents, 'AED');
    document.getElementById('dash-aed-paid').textContent = formatMoney(data.aed_summary.today_paid_cents, 'AED');

    // PKR Card
    document.getElementById('dash-pkr-receivable').textContent = formatMoney(data.pkr_summary.receivable_cents, 'PKR');
    document.getElementById('dash-pkr-payable').textContent = formatMoney(data.pkr_summary.payable_cents, 'PKR');
    document.getElementById('dash-pkr-received').textContent = formatMoney(data.pkr_summary.today_received_cents, 'PKR');
    document.getElementById('dash-pkr-paid').textContent = formatMoney(data.pkr_summary.today_paid_cents, 'PKR');


  } catch (err) {
    console.error('Failed to load dashboard:', err);
    showToast('Failed to load dashboard data: ' + err.message, 'error');
  }
}

// --- 2. Customers View Logic ---

let customerFilterArchived = false;

async function loadCustomers(search = document.getElementById('customers-search-input').value.trim()) {
  try {
    const list = await khataApi.getCustomers(search, customerFilterArchived);
    state.customers = list;
    renderCustomersTable(customerFilterArchived ? list.filter(c => c.is_archived === 1) : list);
  } catch (err) {
    showToast('Failed to load customers: ' + err.message, 'error');
  }
}

function renderCustomersTable(list) {
  list = list || [];
  const infoEl = document.getElementById('customers-page-info');
  if (infoEl) {
    infoEl.textContent = list.length === 1 ? '1 customer' : `${list.length} customers`;
  }
  const tbody = document.getElementById('customers-table-body');
  if (!list || list.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" class="text-center">No customers found. Click <strong>+ Add Customer</strong> to create one.</td></tr>`;
    return;
  }

  tbody.innerHTML = list.map(c => {
    let statusClass = 'badge-zero';
    if (c.status === 'Receivable') statusClass = 'badge-receivable';
    else if (c.status === 'Payable') statusClass = 'badge-payable';

    return `
      <tr>
        <td><span class="account-code-pill">${c.account_code}</span></td>
        <td>${listLine(c.name, true)}</td>
        <td>${listLine(c.mobile || '—')}${listLine(c.address || 'No address', false, true)}</td>
        <td>${listLine(formatMoney(c.balance_cents, c.currency), true)}<span class="balance-caption ${statusClass}" title="${balanceLabel(c.status)}">${shortBalanceLabel(c.status)}</span></td>
        <td class="text-center">
          <div class="list-actions customer-actions">
            <button class="btn btn-primary btn-sm" onclick="openCustomerKhata(${c.id})">Open Khata</button>
            ${state.currentUser?.role === 'Admin' ? `<button class="btn btn-outline btn-sm" onclick="openEditCustomerModal(${c.id})" title="Edit Details">Edit</button>` : ''}
            ${state.currentUser?.role === 'Admin' ? `<button class="btn btn-icon btn-sm" onclick="handleDeleteCustomer(${c.id})" title="Delete Customer">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
            </button>` : ''}
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

// --- Customer Creation & Editing ---

async function prepareNewCustomerModal() {
  try {
    const nextCode = await khataApi.peekNextAccountCode();
    document.getElementById('cust-new-account-code').value = `${nextCode} — Auto Generated`;
    document.getElementById('cust-new-name').value = '';
    document.getElementById('cust-new-mobile').value = '';
    document.getElementById('cust-new-address').value = '';
    document.getElementById('curr-aed').checked = true;
    document.getElementById('lbl-curr-aed').classList.add('active');
    document.getElementById('lbl-curr-pkr').classList.remove('active');
    document.getElementById('cust-new-opening-balance').value = '0.00';
    document.getElementById('cust-new-opening-type').value = 'Zero Balance';
    openModal('modal-new-customer');
  } catch (err) {
    showToast('Error preparing customer modal: ' + err.message, 'error');
  }
}

async function handleSaveCustomer(openKhataImmediately = false) {
  if (state.savingCustomer || !document.getElementById('form-new-customer').reportValidity()) return;
  const name = document.getElementById('cust-new-name').value.trim();
  if (!name) {
    showToast('Customer Name is required.', 'error');
    return;
  }

  const mobile = document.getElementById('cust-new-mobile').value.trim();
  const address = document.getElementById('cust-new-address').value.trim();
  const currency = document.querySelector('input[name="cust_currency"]:checked').value;
  const openingBal = parseAmountToCents(document.getElementById('cust-new-opening-balance').value);
  const openingType = document.getElementById('cust-new-opening-type').value;

  state.savingCustomer = true;
  try {
    const created = await khataApi.createCustomer({
      name,
      mobile,
      address,
      currency,
      opening_balance: openingBal,
      opening_balance_type: openingType
    }, state.currentUser);

    showToast(`Account ${created.account_code} (${created.name}) created successfully!`);
    closeModal('modal-new-customer', true);
    state.savingCustomer = false;
    loadCustomers();

    if (openKhataImmediately) {
      openCustomerKhata(created.id);
    }
  } catch (err) {
    showToast('Failed to save customer: ' + err.message, 'error');
  } finally {
    state.savingCustomer = false;
  }
}

async function openEditCustomerModal(customerId) {
  if (state.currentUser?.role !== 'Admin') return showToast('Only an Administrator can edit customers.', 'error');
  try {
    const cust = await khataApi.getCustomerById(customerId);
    if (!cust) return;

    document.getElementById('edit-cust-id').value = cust.id;
    document.getElementById('edit-cust-code').value = cust.account_code;
    document.getElementById('edit-cust-name').value = cust.name;
    document.getElementById('edit-cust-mobile').value = cust.mobile || '';
    document.getElementById('edit-cust-address').value = cust.address || '';
    document.getElementById('edit-cust-currency').value = cust.currency;
    document.getElementById('edit-cust-opening-bal').value = (cust.opening_balance / 100).toFixed(2);
    document.getElementById('edit-cust-opening-type').value = cust.opening_balance_type;

    openModal('modal-edit-customer');
  } catch (err) {
    showToast('Failed to load customer: ' + err.message, 'error');
  }
}

async function handleUpdateCustomer() {
  const id = document.getElementById('edit-cust-id').value;
  const name = document.getElementById('edit-cust-name').value.trim();
  const mobile = document.getElementById('edit-cust-mobile').value.trim();
  const address = document.getElementById('edit-cust-address').value.trim();
  const openingBal = parseAmountToCents(document.getElementById('edit-cust-opening-bal').value);
  const openingType = document.getElementById('edit-cust-opening-type').value;

  try {
    await khataApi.updateCustomer(id, {
      name,
      mobile,
      address,
      opening_balance: openingBal,
      opening_balance_type: openingType
    }, state.currentUser);

    showToast('Customer updated successfully!');
    closeModal('modal-edit-customer', true);
    loadCustomers();
    if (state.currentCustomer && state.currentCustomer.id == id) {
      openCustomerKhata(id);
    }
  } catch (err) {
    showToast('Update failed: ' + err.message, 'error');
  }
}

function toggleArchiveCustomer(customerId, isCurrentlyArchived) {
  const actionText = isCurrentlyArchived ? 'restore' : 'archive';
  openConfirmDialog(
    `${isCurrentlyArchived ? 'Restore' : 'Archive'} Customer`,
    `Are you sure you want to ${actionText} this customer account? The account code and ledger history will be preserved.`,
    async () => {
      try {
        await khataApi.archiveCustomer(customerId, state.currentUser);
        showToast(`Customer successfully ${actionText}d.`);
        loadCustomers();
      } catch (err) {
        showToast('Archive operation failed: ' + err.message, 'error');
      }
    }
  );
}

function handleDeleteCustomer(customerId) {
  if (state.currentUser && state.currentUser.role !== 'Admin') {
    showToast('Only an Administrator can delete customer accounts.', 'error');
    return;
  }
  openConfirmDialog(
    'Delete Customer Account',
    'Are you sure you want to permanently delete this customer account? All associated transactions, ledger entries, and notes will be permanently removed. This action cannot be undone.',
    async () => {
      try {
        await khataApi.deleteCustomer(customerId, state.currentUser);
        showToast('Customer account deleted successfully.');
        if (state.activeView === 'customer-khata' && state.currentCustomer && state.currentCustomer.id == customerId) {
          navigateTo('customers');
        } else {
          loadCustomers();
        }
      } catch (err) {
        showToast('Deletion failed: ' + err.message, 'error');
      }
    }
  );
}

// --- 3. Customer Khata Ledger View Logic ---

async function openCustomerKhata(customerId) {
  try {
    const cust = await khataApi.getCustomerById(customerId);
    if (!cust) throw new Error('Customer not found');
    state.currentCustomer = cust;

    // Header info
    document.getElementById('khata-code').textContent = cust.account_code;
    document.getElementById('khata-name').textContent = cust.name;
    document.getElementById('khata-avatar').textContent = cust.name.charAt(0).toUpperCase();

    // Currency Badge
    const currBadge = document.getElementById('khata-currency-badge');
    currBadge.className = `badge badge-${cust.currency.toLowerCase()}`;
    currBadge.textContent = cust.currency;

    // Mobile (hide row if empty)
    const mobileRow = document.getElementById('khata-mobile-row');
    if (cust.mobile && cust.mobile.trim()) {
      mobileRow.style.display = 'inline';
      document.getElementById('khata-mobile').textContent = cust.mobile;
    } else {
      mobileRow.style.display = 'none';
    }

    // Address (hide row if empty)
    const addressRow = document.getElementById('khata-address-row');
    if (cust.address && cust.address.trim()) {
      addressRow.style.display = 'inline';
      document.getElementById('khata-address').textContent = cust.address;
    } else {
      addressRow.style.display = 'none';
    }

    // Current Balance & Status Badge
    document.getElementById('khata-balance-val').textContent = formatMoney(cust.balance_cents, cust.currency);
    const statusBadge = document.getElementById('khata-status-badge');
    statusBadge.textContent = balanceLabel(cust.status);
    statusBadge.className = 'badge ' + (cust.status === 'Receivable' ? 'badge-receivable' : (cust.status === 'Payable' ? 'badge-payable' : 'badge-zero'));

    navigateTo('customer-khata');
    loadKhataLedger();
  } catch (err) {
    showToast('Failed to open Khata: ' + err.message, 'error');
  }
}

async function loadKhataLedger() {
  if (!state.currentCustomer) return;
  const custId = state.currentCustomer.id;
  const sort = document.getElementById('khata-sort-filter').value;
  const dateFrom = document.getElementById('khata-date-from').value;
  const dateTo = document.getElementById('khata-date-to').value;

  try {
    const result = await khataApi.getCustomerLedger(custId, sort, dateFrom, dateTo);
    const tbody = document.getElementById('khata-ledger-body');

    // Summary footer
    const cur = result.customer.currency;
    document.getElementById('khata-opening-val').textContent = formatMoney(result.summary.opening_balance, cur) + ` (${result.summary.opening_balance_type})`;
    document.getElementById('khata-total-debit').textContent = formatMoney(result.summary.total_debit, cur);
    document.getElementById('khata-total-credit').textContent = formatMoney(result.summary.total_credit, cur);
    document.getElementById('khata-closing-val').textContent = formatMoney(result.summary.closing_balance, cur) + ` [${balanceLabel(result.summary.closing_status)}]`;

    if (!result.transactions || result.transactions.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" class="text-center" style="padding:24px; color:#94a3b8;">No ledger entries found for this period. Click <strong>+ New Transaction</strong> to add one.</td></tr>`;
      return;
    }

    tbody.innerHTML = result.transactions.map(t => {
      const runningFormatted = formatMoney(t.running_balance, cur);
      const runningStatusBadge = t.status === 'Receivable' ? 'Dr' : (t.status === 'Payable' ? 'Cr' : '—');

      return `
        <tr>
          <td>${formatDate(t.transaction_date)}</td>
          <td><strong style="font-family:monospace; color:#475569;">${t.transaction_code}</strong></td>
          <td>
            <div>${escapeHtml(t.description || '—')}</div>
            ${t.reference_number ? `<span style="font-size:0.75rem; color:#64748b;">Ref: ${escapeHtml(t.reference_number)}</span>` : ''}
          </td>
          <td class="text-right tabular-nums" style="color:#b91c1c; font-weight:600;">
            ${t.debit > 0 ? formatMoney(t.debit, cur) : '—'}
          </td>
          <td class="text-right tabular-nums" style="color:#15803d; font-weight:600;">
            ${t.credit > 0 ? formatMoney(t.credit, cur) : '—'}
          </td>
          <td class="text-right tabular-nums" style="font-weight:700;">
            ${runningFormatted} <small style="color:#64748b; font-weight:600;">${runningStatusBadge}</small>
          </td>
          <td class="text-center">
            <div style="display:inline-flex; gap:4px;">
              <button class="btn btn-outline btn-sm" onclick="showReceiptForTransaction(${t.id})" title="Print Receipt">Receipt</button>
              ${state.currentUser?.role === 'Admin' ? `<button class="btn btn-outline btn-sm" onclick="openEditTransactionModal(${t.id})">Edit</button>` : ''}
              <button class="btn btn-icon btn-sm" onclick="handleDeleteTransaction(${t.id})" title="Delete Transaction">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
              </button>
            </div>
          </td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    showToast('Failed to load ledger: ' + err.message, 'error');
  }
}

// --- 4. Transaction Entry Logic (Strict Customer Currency Lock) ---

async function openQuickTransactionModal(preselectedCustomerId = null) {
  if (!allowLeaveForms()) return;
  try {
    state.editingTransactionId = null;
    document.getElementById('transaction-modal-title').textContent = 'New Transaction Entry';
    document.getElementById('btn-save-transaction').textContent = 'Save Transaction (Ctrl+S)';
    const lockedCustomerId = preselectedCustomerId ?? (state.activeView === 'customer-khata' ? state.currentCustomer?.id : null);
    state.transactionCustomerId = null;
    let customers;
    if (lockedCustomerId != null) {
      const customer = await khataApi.getCustomerById(lockedCustomerId);
      if (!customer) throw new Error('Customer not found.');
      customers = [customer];
      state.transactionCustomerId = customer.id;
    } else {
      customers = await khataApi.getCustomers('', false);
    }
    state.customers = customers;

    const select = document.getElementById('trx-customer-select');
    select.disabled = state.transactionCustomerId != null;
    select.title = select.disabled ? 'Customer is locked to this khata.' : '';
    select.innerHTML = (select.disabled ? '' : '<option value="">-- Choose Customer Khata --</option>') +
      customers.map(c => `
        <option value="${c.id}" data-currency="${c.currency}" data-balance="${c.balance_cents}" data-status="${c.status}" ${preselectedCustomerId && c.id == preselectedCustomerId ? 'selected' : ''}>
          ${c.account_code} — ${escapeHtml(c.name)} (${c.currency})
        </option>
      `).join('');

    // Reset Form Fields
    document.getElementById('trx-debit').value = '';
    document.getElementById('trx-credit').value = '';
    document.getElementById('trx-details').value = '';
    document.getElementById('trx-date').value = localToday();

    // Trigger customer change logic
    handleTrxCustomerSelectChange();

    openModal('modal-new-transaction');
  } catch (err) {
    showToast('Failed to initialize transaction modal: ' + err.message, 'error');
  }
}

function openQuickTransactionForCustomer(customerId) {
  openQuickTransactionModal(customerId);
}

function handleTrxCustomerSelectChange() {
  const select = document.getElementById('trx-customer-select');
  const selectedOpt = select.options[select.selectedIndex];

  const lockedText = document.getElementById('trx-locked-currency-text');
  const currPrefixDebit = document.getElementById('trx-debit-curr-prefix');
  const currPrefixCredit = document.getElementById('trx-credit-curr-prefix');
  const balanceBadge = document.getElementById('trx-customer-balance-badge');

  if (selectedOpt && selectedOpt.value) {
    const currency = selectedOpt.getAttribute('data-currency');
    const balance = selectedOpt.getAttribute('data-balance');
    const status = selectedOpt.getAttribute('data-status');

    lockedText.textContent = `${currency} (Locked to Customer)`;
    lockedText.style.color = currency === 'AED' ? '#059669' : '#2563eb';
    currPrefixDebit.textContent = currency;
    currPrefixCredit.textContent = currency;

    balanceBadge.textContent = `${formatMoney(balance, currency)} (${balanceLabel(status)})`;
    balanceBadge.className = 'badge ' + (status === 'Receivable' ? 'badge-receivable' : (status === 'Payable' ? 'badge-payable' : 'badge-zero'));
  } else {
    lockedText.textContent = 'Select Customer';
    lockedText.style.color = '#64748b';
    currPrefixDebit.textContent = '—';
    currPrefixCredit.textContent = '—';
    balanceBadge.textContent = '—';
    balanceBadge.className = 'badge';
  }
}

async function handleSaveTransaction() {
  if (state.savingTransaction || !document.getElementById('form-new-transaction').reportValidity()) return;
  const custSelect = document.getElementById('trx-customer-select');
  const customerId = state.transactionCustomerId ?? custSelect.value;
  if (!customerId) {
    showToast('Please select a customer.', 'error');
    return;
  }

  const debitCents = parseAmountToCents(document.getElementById('trx-debit').value);
  const creditCents = parseAmountToCents(document.getElementById('trx-credit').value);

  if (debitCents === 0 && creditCents === 0) {
    showToast('Please enter either Debit or Credit amount.', 'error');
    return;
  }
  if (debitCents > 0 && creditCents > 0) {
    showToast('Please enter either Debit OR Credit, not both in a single entry.', 'error');
    return;
  }

  const currentSelectedTrxType = debitCents > 0 ? 'Debit' : 'Credit';
  const amountCents = debitCents > 0 ? debitCents : creditCents;

  const dateVal = document.getElementById('trx-date').value;
  if (!dateVal) {
    showToast('Transaction date is required.', 'error');
    return;
  }

  const details = document.getElementById('trx-details').value.trim();
  if (!details) {
    showToast('Transaction details / description is required.', 'error');
    return;
  }

  state.savingTransaction = true;
  const savedType = currentSelectedTrxType;
  try {
    const payload = {
      customer_id: customerId,
      transaction_date: dateVal,
      transaction_type: currentSelectedTrxType,
      amount: amountCents,
      description: details,
      payment_method: 'Cash',
      reference_number: '',
      notes: ''
    };
    const editingId = state.editingTransactionId;
    const res = editingId
      ? { transaction: await khataApi.updateTransaction(editingId, payload, state.currentUser) }
      : await khataApi.createTransaction(payload, state.currentUser);

    showToast(`Transaction ${res.transaction.transaction_code} ${editingId ? 'updated' : 'recorded'} successfully!`);
    closeModal('modal-new-transaction', true);
    state.savingTransaction = false;

    // Refresh active views
    if (state.activeView === 'dashboard') loadDashboard();
    else if (state.activeView === 'customers') loadCustomers();
    else if (state.activeView === 'transactions') loadTransactions();
    else if (state.activeView === 'customer-khata' && state.currentCustomer && state.currentCustomer.id == customerId) {
      openCustomerKhata(customerId);
    }

    // If Credit, ask user if they want to view/print receipt
    if (savedType === 'Credit' && res.receipt) {
      setTimeout(() => {
        showReceiptForTransaction(res.transaction.id);
      }, 300);
    }
  } catch (err) {
    showToast('Failed to record transaction: ' + err.message, 'error');
  } finally {
    state.savingTransaction = false;
  }
}

function handleDeleteTransaction(trxId) {
  if (state.currentUser && state.currentUser.role !== 'Admin') {
    showToast('Only an Administrator can delete historical transactions.', 'error');
    return;
  }

  openConfirmDialog(
    'Delete Historical Transaction',
    'Are you sure you want to permanently delete this transaction? All running balances will be recalculated automatically and an audit log will be created.',
    async () => {
      try {
        await khataApi.deleteTransaction(trxId, state.currentUser);
        showToast('Transaction deleted. Balances recalculated successfully.');
        if (state.activeView === 'customer-khata') {
          openCustomerKhata(state.currentCustomer.id);
        } else if (state.activeView === 'transactions') {
          loadTransactions();
        } else if (state.activeView === 'dashboard') {
          loadDashboard();
        }
      } catch (err) {
        showToast('Deletion failed: ' + err.message, 'error');
      }
    }
  );
}

// --- 5. All Transactions View Logic ---

async function loadTransactions() {
  const currency = document.getElementById('filter-trx-currency').value;
  const type = document.getElementById('filter-trx-type').value;
  const dateFrom = document.getElementById('filter-trx-date-from').value;
  const dateTo = document.getElementById('filter-trx-date-to').value;
  const search = document.getElementById('global-search-input').value;

  try {
    const minInput = document.getElementById('filter-trx-min');
    const maxInput = document.getElementById('filter-trx-max');
    if (!minInput.reportValidity() || !maxInput.reportValidity()) return;
    const list = await khataApi.getAllTransactions({
      customer_id: document.getElementById('filter-trx-customer').value,
      payment_method: document.getElementById('filter-trx-payment').value,
      amount_min: minInput.value === '' ? undefined : parseAmountToCents(minInput.value),
      amount_max: maxInput.value === '' ? undefined : parseAmountToCents(maxInput.value),
      currency,
      transaction_type: type,
      date_from: dateFrom,
      date_to: dateTo,
      search
    });

    renderTransactionsTable(list);
  } catch (err) {
    showToast('Failed to load transactions: ' + err.message, 'error');
    document.getElementById('all-transactions-body').innerHTML = '';
    document.getElementById('transaction-filter-summary').textContent = err.message;
  }
}

function renderTransactionsTable(records) {
  const list = records || [];
  const infoEl = document.getElementById('transactions-page-info');
  if (infoEl) {
    infoEl.textContent = list.length === 1 ? '1 transaction' : `${list.length} transactions`;
  }
  const tbody = document.getElementById('all-transactions-body');
  document.getElementById('transaction-filter-summary').textContent = 'Amounts use each account’s currency. AED and PKR stay separate.';
  tbody.innerHTML = list.map(t => `<tr>
    <td>${listLine(formatDate(t.transaction_date))}${listLine(t.transaction_code, false, true)}</td>
    <td>${listLine(t.customer_name, true)}${listLine('Account ' + t.account_code, false, true)}</td>
    <td>${listLine(t.description || '—')}${listLine(t.payment_method || '—', false, true)}${t.reference_number ? listLine('Ref: ' + t.reference_number, false, true) : ''}</td>
    <td class="text-right">${listLine(t.transaction_type === 'Debit' ? formatMoney(t.amount, t.currency) : '—', true)}</td>
    <td class="text-right">${listLine(t.transaction_type === 'Credit' ? formatMoney(t.amount, t.currency) : '—', true)}</td>
    <td><div class="list-actions transaction-actions">
      <button class="btn btn-outline btn-sm" onclick="openCustomerKhata(${t.customer_id})">Khata</button>
      ${state.currentUser?.role === 'Admin' ? `<button class="btn btn-outline btn-sm" onclick="openEditTransactionModal(${t.id})">Edit</button>` : ''}
      <button class="btn btn-outline btn-sm" onclick="showReceiptForTransaction(${t.id})">Receipt</button>
      ${state.currentUser?.role === 'Admin' ? `<button class="btn btn-outline btn-sm" onclick="handleDeleteTransaction(${t.id})">Delete</button>` : ''}
    </div></td>
  </tr>`).join('') || '<tr><td colspan="6" class="text-center">No transactions match these filters.</td></tr>';
}

// --- 6. Statement Modal & Printing ---

async function openCustomerStatementModal(customerId) {
  try {
    const cust = await khataApi.getCustomerById(customerId);
    const ledgerData = await khataApi.getCustomerLedger(customerId, 'ASC');
    const settings = await khataApi.getSettings();

    // Populate Business Header
    document.getElementById('stmt-biz-name').textContent = settings.business_name || 'Simple Khata Store';
    document.getElementById('stmt-biz-owner').textContent = settings.owner_name ? `Owner: ${settings.owner_name}` : '';
    document.getElementById('stmt-biz-phone').textContent = settings.mobile ? `Tel: ${settings.mobile}` : '';
    document.getElementById('stmt-biz-address').textContent = settings.address || '';
    addPrintLogo('statement-paper', settings.logo_base64);

    // Populate Customer Meta
    document.getElementById('stmt-cust-code').textContent = cust.account_code;
    document.getElementById('stmt-cust-name').textContent = cust.name;

    const mobWrap = document.getElementById('stmt-cust-mobile-wrap');
    if (cust.mobile) {
      mobWrap.style.display = 'block';
      document.getElementById('stmt-cust-mobile').textContent = cust.mobile;
    } else {
      mobWrap.style.display = 'none';
    }

    const addrWrap = document.getElementById('stmt-cust-addr-wrap');
    if (cust.address) {
      addrWrap.style.display = 'block';
      document.getElementById('stmt-cust-addr').textContent = cust.address;
    } else {
      addrWrap.style.display = 'none';
    }

    const cur = cust.currency;
    document.getElementById('stmt-currency').textContent = cur;
    document.getElementById('stmt-date-generated').textContent = `Generated: ${new Date().toLocaleDateString('en-GB')}`;

    // Table rows
    const tbody = document.getElementById('stmt-table-body');
    tbody.innerHTML = ledgerData.transactions.map(t => `
      <tr>
        <td>${formatDate(t.transaction_date)}</td>
        <td>${escapeHtml(t.description || '—')}</td>
        <td class="text-right tabular-nums">${t.debit > 0 ? formatMoney(t.debit, '', true) : '—'}</td>
        <td class="text-right tabular-nums">${t.credit > 0 ? formatMoney(t.credit, '', true) : '—'}</td>
        <td class="text-right tabular-nums" style="font-weight:700; color:${t.running_balance > 0 ? '#dc2626' : (t.running_balance < 0 ? '#16a34a' : 'inherit')};">${formatMoney(t.running_balance, cur, true)} ${t.running_balance > 0 ? 'Dr' : (t.running_balance < 0 ? 'Cr' : '')}</td>
      </tr>
    `).join('');

    // Totals Box
    document.getElementById('stmt-calc-opening').textContent = formatMoney(ledgerData.summary.opening_balance, cur, true);
    document.getElementById('stmt-calc-debit').textContent = formatMoney(ledgerData.summary.total_debit, cur, true);
    document.getElementById('stmt-calc-credit').textContent = formatMoney(ledgerData.summary.total_credit, cur, true);
    document.getElementById('stmt-calc-closing').textContent = formatMoney(ledgerData.summary.closing_balance, cur, true);

    openModal('modal-statement');
  } catch (err) {
    showToast('Failed to load statement: ' + err.message, 'error');
  }
}

// --- 7. Receipts Modal & Printing ---

async function showReceiptForTransaction(trxId) {
  try {
    const rec = await khataApi.getReceipt(trxId);
    if (!rec) {
      showToast('No receipt found for this transaction.', 'error');
      return;
    }

    const titleEl = document.getElementById('receipt-modal-title');
    if (titleEl) {
      titleEl.textContent = rec.transaction_type === 'Debit' ? 'Payment Voucher (Debit)' : 'Payment Receipt (Credit)';
    }

    const settings = await khataApi.getSettings();
    document.getElementById('rec-biz-name').textContent = settings.business_name || 'Simple Khata Store';
    addPrintLogo('receipt-paper', settings.logo_base64);
    document.getElementById('rec-biz-phone').textContent = settings.mobile ? `Tel: ${settings.mobile}` : '';
    document.getElementById('rec-number').textContent = rec.receipt_number;
    document.getElementById('rec-date').textContent = `Date: ${formatDate(rec.transaction_date)}`;

    document.getElementById('rec-cust-name').textContent = `${rec.customer_name} (Account ${rec.account_code})`;
    document.getElementById('rec-method').textContent = rec.payment_method;
    document.getElementById('rec-trx-id').textContent = rec.transaction_code;
    document.getElementById('rec-details').textContent = rec.description || (rec.transaction_type === 'Debit' ? 'Cash Given' : 'Cash Received');

    const amountLabel = document.getElementById('rec-amount-label');
    if (amountLabel) amountLabel.textContent = rec.transaction_type === 'Debit' ? 'Debit Amount' : 'Credit Amount';

    const cur = rec.currency;
    document.getElementById('rec-prev-bal').textContent = formatMoney(rec.previous_balance_cents, cur);
    document.getElementById('rec-amount').textContent = formatMoney(rec.amount, cur);

    const remStatus = rec.remaining_balance_cents > 0 ? 'Receivable' : (rec.remaining_balance_cents < 0 ? 'Payable' : 'Settled');
    document.getElementById('rec-remaining-bal').textContent = `${formatMoney(rec.remaining_balance_cents, cur)} (${balanceLabel(remStatus)})`;

    openModal('modal-receipt');
  } catch (err) {
    showToast('Failed to generate receipt: ' + err.message, 'error');
  }
}

// --- 8. Customer Notes ---

async function openCustomerNotesModal() {
  if (!state.currentCustomer) return;
  const cust = state.currentCustomer;
  document.getElementById('notes-modal-title').textContent = `Notes: Account ${cust.account_code} — ${cust.name}`;
  document.getElementById('new-note-text').value = '';
  loadCustomerNotesList();
  openModal('modal-customer-notes');
}

async function loadCustomerNotesList() {
  if (!state.currentCustomer) return;
  try {
    const notes = await khataApi.getCustomerNotes(state.currentCustomer.id);
    const container = document.getElementById('notes-list-container');

    if (!notes || notes.length === 0) {
      container.innerHTML = `<div style="text-align:center; padding:16px; color:#94a3b8; font-size:0.85rem;">No notes recorded for this customer yet.</div>`;
      return;
    }

    container.innerHTML = notes.map(n => `
      <div class="note-item">
        <div class="note-header">
          <span>By: <strong>${escapeHtml(n.created_by)}</strong></span>
          <span>${formatDate(n.created_at)}</span>
        </div>
        <div style="color:#0f172a; line-height:1.4;">${escapeHtml(n.note)}</div>
      </div>
    `).join('');
  } catch (err) {
    showToast('Failed to load notes: ' + err.message, 'error');
  }
}

async function handleAddCustomerNote() {
  if (!state.currentCustomer) return;
  const noteText = document.getElementById('new-note-text').value.trim();
  if (!noteText) {
    showToast('Please type a note.', 'error');
    return;
  }

  try {
    await khataApi.addCustomerNote(state.currentCustomer.id, noteText, state.currentUser);
    document.getElementById('new-note-text').value = '';
    showToast('Note added successfully.');
    loadCustomerNotesList();
  } catch (err) {
    showToast('Failed to add note: ' + err.message, 'error');
  }
}

// --- 9. Financial Reports View Logic ---

let currentReportType = 'balance';

async function loadReports() {
  try {
  const currencyFilter = document.getElementById('report-currency-filter').value;
  const settings = await khataApi.getSettings();

  document.getElementById('report-biz-name').textContent = settings.business_name || 'Simple Khata Store';
  addPrintLogo('report-paper-container', settings.logo_base64);
  document.getElementById('report-biz-address').textContent = settings.address || '';
  document.getElementById('report-biz-phone').textContent = settings.mobile ? `Tel: ${settings.mobile}` : '';
  document.getElementById('report-generated-date').textContent = `Generated: ${new Date().toLocaleDateString('en-GB')}`;

  const titles = {
    balance: 'CUSTOMER BALANCE REPORT',
    receivable: 'RECEIVABLE ACCOUNTS REPORT',
    payable: 'PAYABLE ACCOUNTS REPORT',
    daily: 'DAILY TRANSACTIONS REPORT',
    custom: 'CUSTOM DATE RANGE REPORT'
  };
  document.getElementById('report-sheet-title').textContent = titles[currentReportType] || 'FINANCIAL REPORT';

    let reportData = null;
    const dated = currentReportType === 'daily' || currentReportType === 'custom';
    document.getElementById('report-filter-bar').style.display = dated ? 'flex' : 'none';
    document.getElementById('report-to-label').style.display = currentReportType === 'custom' ? '' : 'none';
    document.getElementById('report-date-to-input').style.display = currentReportType === 'custom' ? '' : 'none';
    document.getElementById('report-totals-footer').style.display = dated ? 'none' : 'grid';
    if (dated) {
      const dateInput = document.getElementById('report-date-input');
      if (!dateInput.value) dateInput.value = localToday();
      const from = dateInput.value;
      const to = currentReportType === 'daily' ? from : document.getElementById('report-date-to-input').value;
      if (!to || to < from) {
        document.getElementById('report-sheet-body').innerHTML = '';
        showToast('Select a valid start and end date.', 'error');
        return;
      }
      const rows = await khataApi.getAllTransactions({ currency: currencyFilter, date_from: from, date_to: to });
      document.getElementById('report-sheet-header-row').innerHTML = '<th>Date</th><th>Transaction</th><th>Customer</th><th>Currency</th><th>Details</th><th>Debit</th><th>Credit</th>';
      document.getElementById('report-sheet-body').innerHTML = rows.map(t => `<tr><td>${formatDate(t.transaction_date)}</td><td>${escapeHtml(t.transaction_code)}</td><td>${escapeHtml(t.customer_name)}</td><td>${escapeHtml(t.currency)}</td><td>${escapeHtml(t.description)}</td><td>${t.transaction_type === 'Debit' ? formatMoney(t.amount, t.currency) : '—'}</td><td>${t.transaction_type === 'Credit' ? formatMoney(t.amount, t.currency) : '—'}</td></tr>`).join('') || '<tr><td colspan="7">No transactions for this period.</td></tr>';
      return;
    }
    document.getElementById('report-sheet-header-row').innerHTML = '<th>Account Code</th><th>Customer Name</th><th>Currency</th><th>Total Debit</th><th>Total Credit</th><th>Current Balance</th><th>Status</th>';
    if (currentReportType === 'balance') {
      reportData = await khataApi.getCustomerBalanceReport(currencyFilter);
    } else if (currentReportType === 'receivable') {
      reportData = await khataApi.getReceivableReport(currencyFilter);
    } else if (currentReportType === 'payable') {
      reportData = await khataApi.getPayableReport(currencyFilter);
    }

    renderReportTable(reportData);
  } catch (err) {
    showToast('Failed to generate report: ' + err.message, 'error');
  }
}

function renderReportTable(reportData) {
  const tbody = document.getElementById('report-sheet-body');
  if (!reportData.rows || reportData.rows.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="text-center" style="padding:24px; color:#94a3b8;">No customer records match this report.</td></tr>`;
  } else {
    tbody.innerHTML = reportData.rows.map(r => `
      <tr>
        <td><span class="account-code-pill">${r.account_code}</span></td>
        <td><strong>${escapeHtml(r.name)}</strong></td>
        <td><span class="badge badge-${r.currency.toLowerCase()}">${r.currency}</span></td>
        <td class="text-right tabular-nums">${formatMoney(r.total_debit, r.currency)}</td>
        <td class="text-right tabular-nums">${formatMoney(r.total_credit, r.currency)}</td>
        <td class="text-right tabular-nums" style="font-weight:700;">${formatMoney(r.current_balance, r.currency)}</td>
        <td><span class="badge ${r.status === 'Receivable' ? 'badge-receivable' : (r.status === 'Payable' ? 'badge-payable' : 'badge-zero')}">${balanceLabel(r.status)}</span></td>
      </tr>
    `).join('');
  }

  // Update AED & PKR Separate Footers
  document.getElementById('report-aed-receivable').textContent = formatMoney(reportData.aedTotals.receivable, 'AED');
  document.getElementById('report-aed-payable').textContent = formatMoney(reportData.aedTotals.payable, 'AED');

  document.getElementById('report-pkr-receivable').textContent = formatMoney(reportData.pkrTotals.receivable, 'PKR');
  document.getElementById('report-pkr-payable').textContent = formatMoney(reportData.pkrTotals.payable, 'PKR');
}

// --- 10. Backup & Recovery View Logic ---

async function loadBackups() {
  loadDriveStatus();
  try {
    await refreshBackupStatus();
    const list = await khataApi.getBackups();
    const settings = await khataApi.getSettings();

    document.getElementById('auto-backup-frequency-select').value = settings.auto_backup_frequency || 'Daily';
    const dirInput = document.getElementById('auto-backup-dir-input');
    if (dirInput) {
      dirInput.value = settings.auto_backup_directory || '';
      dirInput.placeholder = settings.auto_backup_directory ? '' : 'No directory selected';
    }

    const tbody = document.getElementById('backups-table-body');
    if (!list || list.length === 0) {
      tbody.innerHTML = `<tr><td colspan="4" class="text-center" style="padding:24px; color:#94a3b8;">No backups found on disk. Click <strong>Create Backup Now</strong> to generate one.</td></tr>`;
      return;
    }

    tbody.innerHTML = list.map(b => `
      <tr>
        <td>${formatDate(b.created_at)}</td>
        <td><strong style="font-family:monospace;">${escapeHtml(b.filename)}</strong></td>
        <td>${b.formatted_size}</td>
        <td class="text-center">
          <button class="btn btn-outline btn-sm" onclick="handleRestoreBackup('${escapeHtml(escapeJsString(b.filepath))}')">Restore</button>
        </td>
      </tr>
    `).join('');
  } catch (err) {
    showToast('Failed to load backup list: ' + err.message, 'error');
  }
}

async function handleCreateBackupNow() {
  try {
    const res = await khataApi.createBackup(state.currentUser);
    showToast(`Backup ${res.filename} created successfully!`);
    loadBackups();
  } catch (err) {
    showToast('Backup creation failed: ' + err.message, 'error');
  }
}

function handleRestoreBackup(filepath) {
  openConfirmDialog(
    'Restore Database Backup',
    'Restoring will overwrite current live records with the selected backup snapshot. All balances will be recalculated. Do you wish to continue?',
    async () => {
      try {
        await khataApi.restoreBackup(filepath, state.currentUser);
        showToast('Database restored successfully! Reloading data...');
        setTimeout(() => {
          window.location.reload();
        }, 1200);
      } catch (err) {
        showToast('Restore failed: ' + err.message, 'error');
      }
    }
  );
}

async function handleRestoreFromFile() {
  try {
    const filepath = await khataApi.pickRestoreFile();
    if (!filepath) return; // User canceled
    handleRestoreBackup(filepath);
  } catch (err) {
    showToast('Failed to pick file: ' + err.message, 'error');
  }
}

// --- 11. Settings & Business Profile View Logic ---

async function loadSettings() {
  try {
    const settings = await khataApi.getSettings();
    state.settings = settings;
    updateLogoPreview(settings.logo_base64);

    document.getElementById('cfg-business-name').value = settings.business_name || '';
    document.getElementById('cfg-owner-name').value = settings.owner_name || '';
    document.getElementById('cfg-mobile').value = settings.mobile || '';
    document.getElementById('cfg-whatsapp').value = settings.whatsapp || '';
    document.getElementById('cfg-address').value = settings.address || '';
    document.getElementById('cfg-require-login').checked = settings.require_login === '1';
    rememberForm('form-business-profile');
    rememberForm('form-change-password');

    // Update business name in sidebar
    if (settings.business_name) {
      document.getElementById('sidebar-business-name').textContent = settings.business_name;
    }

    loadUsersList();
    loadAuditLogs();
  } catch (err) {
    showToast('Failed to load settings: ' + err.message, 'error');
  }
}

async function handleSaveBusinessProfile(e) {
  e.preventDefault();
  const bName = document.getElementById('cfg-business-name').value.trim();
  const oName = document.getElementById('cfg-owner-name').value.trim();
  const mobile = document.getElementById('cfg-mobile').value.trim();
  const whatsapp = document.getElementById('cfg-whatsapp').value.trim();
  const address = document.getElementById('cfg-address').value.trim();

  try {
    await khataApi.updateSettings({
      business_name: bName,
      owner_name: oName,
      mobile,
      whatsapp,
      address
    }, state.currentUser);

    showToast('Business profile updated successfully!');
    rememberForm('form-business-profile');
    document.getElementById('sidebar-business-name').textContent = bName || 'Simple Khata';
  } catch (err) {
    showToast('Save failed: ' + err.message, 'error');
  }
}

async function loadUsersList() {
  if (state.currentUser?.role !== 'Admin') return;
  try {
    const users = await khataApi.getUsers();
    const tbody = document.getElementById('users-table-body');
    tbody.innerHTML = users.map(u => `
      <tr>
        <td><strong>${escapeHtml(u.name)}</strong></td>
        <td>${escapeHtml(u.username)}</td>
        <td><span class="badge ${u.role === 'Admin' ? 'badge-aed' : 'badge-pkr'}">${u.role}</span></td>
        <td>${formatDate(u.created_at)}</td>
        <td class="text-center">
          ${u.id !== state.currentUser.id ? `<button class="btn btn-danger btn-sm" onclick="handleDeleteUser(${u.id})">Delete</button>` : '<small style="color:#94a3b8;">Current</small>'}
        </td>
      </tr>
    `).join('');
  } catch (err) {
    console.error('Users load error:', err);
  }
}

async function loadAuditLogs() {
  if (state.currentUser?.role !== 'Admin') return;
  try {
    const logs = await khataApi.getAuditLogs(100);
    const tbody = document.getElementById('audit-table-body');
    if (!logs || logs.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" class="text-center" style="padding:20px; color:#94a3b8;">No audit logs yet.</td></tr>`;
      return;
    }
    tbody.innerHTML = logs.map(l => `
      <tr>
        <td>${formatDate(l.created_at)}</td>
        <td><strong>${escapeHtml(l.user_name || 'System')}</strong></td>
        <td><span class="badge" style="background:#f1f5f9;">${l.action}</span></td>
        <td>${l.entity_type}</td>
        <td>${escapeHtml(l.description)}</td>
      </tr>
    `).join('');
  } catch (err) {
    console.error('Audit load error:', err);
  }
}

// --- Keyboard Shortcuts & Global Events ---

window.addEventListener('keydown', (e) => {
  if (!state.currentUser) return;
  // Ctrl + N = New Transaction
  if (e.ctrlKey && (e.key === 'n' || e.key === 'N')) {
    e.preventDefault();
    openQuickTransactionModal(state.activeView === 'customer-khata' ? state.currentCustomer?.id : null);
  }

  // Ctrl + F = Global Search
  if (e.ctrlKey && (e.key === 'f' || e.key === 'F')) {
    e.preventDefault();
    const searchInput = document.getElementById('global-search-input');
    if (searchInput) searchInput.focus();
  }

  // Esc = Close active modal
  if (e.key === 'Escape' && state.activeModal) {
    e.preventDefault();
    closeModal(state.activeModal);
  }

  // Ctrl + S = Submit active modal form
  if (e.ctrlKey && (e.key === 's' || e.key === 'S')) {
    e.preventDefault();
    if (state.activeModal === 'modal-new-transaction') {
      handleSaveTransaction();
    } else if (state.activeModal === 'modal-new-customer') {
      handleSaveCustomer(false);
    }
  }
});

// --- Utility Functions ---

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function escapeJsString(str) {
  if (!str) return '';
  return String(str).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

// --- Initialization & Event Listeners Attachment ---

function initApp() {
  // Expose global methods for inline HTML onclick/onchange handlers
  window.navigateTo = navigateTo;
  window.closeModal = closeModal;
  window.openCustomerNotesModal = openCustomerNotesModal;
  
  window.switchReportTab = (reportType) => {
    document.querySelectorAll('[data-report]').forEach(b => b.classList.remove('active'));
    const btn = document.querySelector(`[data-report="${reportType}"]`);
    if(btn) btn.classList.add('active');
    currentReportType = reportType;
    loadReports();
  };

  window.switchCustomerFilter = (isArchived) => {
    customerFilterArchived = isArchived;
    if (isArchived) {
      document.getElementById('tab-cust-archived').classList.add('active');
      document.getElementById('tab-cust-active').classList.remove('active');
    } else {
      document.getElementById('tab-cust-active').classList.add('active');
      document.getElementById('tab-cust-archived').classList.remove('active');
    }
    loadCustomers();
  };

  window.switchSettingsTab = (tab) => {
    if (!allowLeaveForms()) return;
    document.getElementById('settings-tab-profile-content').style.display = tab === 'profile' ? 'block' : 'none';
    document.getElementById('settings-tab-security-content').style.display = tab === 'security' ? 'block' : 'none';
    document.getElementById('settings-tab-audit-content').style.display = tab === 'audit' ? 'block' : 'none';
    document.getElementById('tab-settings-profile').classList.toggle('active', tab === 'profile');
    document.getElementById('tab-settings-security').classList.toggle('active', tab === 'security');
    document.getElementById('tab-settings-audit').classList.toggle('active', tab === 'audit');
    if (tab === 'security') loadUsersList();
    if (tab === 'audit') loadAuditLogs();
  };

  // Navigation (Fallback for elements that still use .nav-item without onclick)
  document.querySelectorAll('.nav-item').forEach(item => {
    if (!item.hasAttribute('onclick')) {
      item.addEventListener('click', () => {
        const view = item.getAttribute('data-view');
        if (view) navigateTo(view);
      });
    }
  });

  // Sidebar Quick New Trx
  const btnQuickNewTrx = document.getElementById('btn-quick-new-trx');
  if (btnQuickNewTrx) btnQuickNewTrx.addEventListener('click', () => openQuickTransactionModal());

  // Global Search input handler (debounced)
  const globalSearch = document.getElementById('global-search-input');
  if (globalSearch) {
    const debouncedGlobalSearch = debounce((val) => {
      if (state.activeView === 'customers') {
        document.getElementById('customers-search-input').value = val;
        loadCustomers(val);
      } else if (state.activeView === 'transactions') {
        loadTransactions();
      }
    }, 180);

    globalSearch.addEventListener('input', (e) => {
      const val = e.target.value.trim();
      if (state.activeView !== 'customers' && state.activeView !== 'transactions') {
        navigateTo('customers');
      }
      debouncedGlobalSearch(val);
    });
  }

  // Customers Search (debounced)
  const custSearch = document.getElementById('customers-search-input');
  if (custSearch) {
    const debouncedCustSearch = debounce((val) => {
      loadCustomers(val);
    }, 180);

    custSearch.addEventListener('input', (e) => {
      debouncedCustSearch(e.target.value.trim());
    });
  }

  // Modal Closers
  document.querySelectorAll('[data-close-modal]').forEach(btn => {
    btn.addEventListener('click', () => {
      closeModal(btn.getAttribute('data-close-modal'));
    });
  });

  // New Customer Buttons
  document.getElementById('btn-open-new-customer-modal')?.addEventListener('click', prepareNewCustomerModal);
  document.getElementById('btn-dashboard-new-customer')?.addEventListener('click', prepareNewCustomerModal);
  document.getElementById('form-new-customer')?.addEventListener('submit', (e) => {
    e.preventDefault();
    handleSaveCustomer(false);
  });
  document.getElementById('btn-save-cust-and-open')?.addEventListener('click', () => {
    handleSaveCustomer(true);
  });

  // Currency Radio Button Toggle styling
  const rAed = document.getElementById('curr-aed');
  const rPkr = document.getElementById('curr-pkr');
  const lblAed = document.getElementById('lbl-curr-aed');
  const lblPkr = document.getElementById('lbl-curr-pkr');

  rAed?.addEventListener('change', () => {
    lblAed.classList.add('active');
    lblPkr.classList.remove('active');
  });
  rPkr?.addEventListener('change', () => {
    lblPkr.classList.add('active');
    lblAed.classList.remove('active');
  });

  // Edit Customer Form
  document.getElementById('form-edit-customer')?.addEventListener('submit', (e) => {
    e.preventDefault();
    handleUpdateCustomer();
  });

  // Khata Screen Buttons
  document.getElementById('btn-back-to-customers')?.addEventListener('click', () => navigateTo('customers'));
  document.getElementById('btn-khata-add-trx')?.addEventListener('click', () => {
    if (state.currentCustomer) openQuickTransactionForCustomer(state.currentCustomer.id);
  });
  document.getElementById('btn-khata-print-statement')?.addEventListener('click', () => {
    if (state.currentCustomer) openCustomerStatementModal(state.currentCustomer.id);
  });
  document.getElementById('btn-khata-notes')?.addEventListener('click', openCustomerNotesModal);
  document.getElementById('btn-khata-edit-cust')?.addEventListener('click', () => {
    if (state.currentCustomer) openEditCustomerModal(state.currentCustomer.id);
  });
  document.getElementById('btn-khata-delete-cust')?.addEventListener('click', () => {
    if (state.currentCustomer) handleDeleteCustomer(state.currentCustomer.id);
  });
  document.getElementById('btn-save-note')?.addEventListener('click', handleAddCustomerNote);

  // Khata Filters
  document.getElementById('khata-sort-filter')?.addEventListener('change', loadKhataLedger);
  document.getElementById('khata-date-from')?.addEventListener('change', loadKhataLedger);
  document.getElementById('khata-date-to')?.addEventListener('change', loadKhataLedger);
  document.getElementById('btn-khata-reset-filter')?.addEventListener('click', () => {
    document.getElementById('khata-date-from').value = '';
    document.getElementById('khata-date-to').value = '';
    document.getElementById('khata-sort-filter').value = 'ASC';
    loadKhataLedger();
  });

  // New Transaction Form
  document.getElementById('trx-customer-select')?.addEventListener('change', handleTrxCustomerSelectChange);
  document.getElementById('form-new-transaction')?.addEventListener('submit', (e) => {
    e.preventDefault();
    handleSaveTransaction();
  });

  // All Transactions Filters
  document.getElementById('btn-view-all-trx')?.addEventListener('click', () => navigateTo('transactions'));
  document.getElementById('filter-trx-currency')?.addEventListener('change', loadTransactions);
  document.getElementById('filter-trx-type')?.addEventListener('change', loadTransactions);
  document.getElementById('filter-trx-date-from')?.addEventListener('change', loadTransactions);
  document.getElementById('filter-trx-date-to')?.addEventListener('change', loadTransactions);
  document.getElementById('btn-clear-trx-filters')?.addEventListener('click', () => {
    for (const id of ['filter-trx-customer', 'filter-trx-payment', 'filter-trx-min', 'filter-trx-max', 'global-search-input']) document.getElementById(id).value = '';
    document.getElementById('filter-trx-currency').value = '';
    document.getElementById('filter-trx-type').value = '';
    document.getElementById('filter-trx-date-from').value = '';
    document.getElementById('filter-trx-date-to').value = '';
    loadTransactions();
  });

  // Statement & Receipt Printing
  document.getElementById('btn-print-statement-now')?.addEventListener('click', () => printDocument('modal-statement'));
  document.getElementById('btn-print-receipt-now')?.addEventListener('click', () => printDocument('modal-receipt'));
  document.getElementById('btn-print-report')?.addEventListener('click', () => printDocument('report-paper-container'));

  // Confirm Submit
  document.getElementById('btn-confirm-action-submit')?.addEventListener('click', () => {
    if (state.pendingConfirmAction) {
      state.pendingConfirmAction();
      state.pendingConfirmAction = null;
    }
    closeModal('modal-confirm');
  });

  document.getElementById('report-currency-filter')?.addEventListener('change', loadReports);

  // Backup & Recovery
  bindDriveBackupControls();
  document.getElementById('btn-create-backup-now')?.addEventListener('click', handleCreateBackupNow);
  document.getElementById('btn-restore-from-file')?.addEventListener('click', handleRestoreFromFile);
  document.getElementById('btn-save-backup-freq')?.addEventListener('click', async () => {
    try {
      const val = document.getElementById('auto-backup-frequency-select').value;
      await khataApi.updateSettings({ auto_backup_frequency: val }, state.currentUser);
      await refreshBackupStatus();
      showToast('Automatic backup schedule updated.');
    } catch (err) { showToast(err.message, 'error'); }
  });

  document.getElementById('btn-choose-backup-dir')?.addEventListener('click', async () => {
    try {
      const dirPath = await khataApi.pickBackupDirectory();
      if (dirPath) {
        await khataApi.updateSettings({ auto_backup_directory: dirPath }, state.currentUser);
        document.getElementById('auto-backup-dir-input').value = dirPath;
        showToast('Auto Cloud Backup directory saved.');
      }
    } catch (err) { showToast('Failed to select directory: ' + err.message, 'error'); }
  });

  document.getElementById('btn-clear-backup-dir')?.addEventListener('click', async () => {
    try {
      await khataApi.updateSettings({ auto_backup_directory: '' }, state.currentUser);
      document.getElementById('auto-backup-dir-input').value = '';
      showToast('Auto Cloud Backup disabled.');
    } catch (err) { showToast('Failed to clear directory: ' + err.message, 'error'); }
  });

  document.getElementById('form-business-profile')?.addEventListener('submit', handleSaveBusinessProfile);

  // Require Login Toggle
  document.getElementById('cfg-require-login')?.addEventListener('change', async (e) => {
    try {
      await khataApi.updateSettings({ require_login: e.target.checked ? '1' : '0' }, state.currentUser);
      showToast(`Password login on startup ${e.target.checked ? 'Enabled' : 'Disabled'}.`);
    } catch (err) {
      e.target.checked = !e.target.checked;
      showToast(err.message, 'error');
    }
  });

  attachAdditionalActions();
  attachImprovementActions();
  bootApplication();
}

function localToday() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function printDocument(id) {
  document.querySelectorAll('.print-target, .print-ancestor').forEach(el => el.classList.remove('print-target', 'print-ancestor'));
  const target = document.getElementById(id);
  target.classList.add('print-target');
  for (let parent = target.parentElement; parent; parent = parent.parentElement) parent.classList.add('print-ancestor');
  window.print();
}

function exportTableCsv(selector, filename) {
  const rows = [...document.querySelectorAll(`${selector} tr`)];
  const csv = rows.map(row => [...row.cells].map(cell => {
    const text = cell.textContent.trim();
    const safe = /^[=+@-]/.test(text) ? `'${text}` : text;
    return `"${safe.replace(/"/g, '""')}"`;
  }).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function showLogin() {
  if (!allowLeaveForms()) return;
  try { await khataApi.logout(); }
  catch (err) { showToast(err.message, 'error'); return; }
  document.querySelectorAll('.active-modal').forEach(modal => modal.classList.remove('active-modal'));
  state.currentUser = null;
  state.currentCustomer = null;
  document.getElementById('app-container').inert = true;
  document.getElementById('form-login').reset();
  document.getElementById('login-error-msg').style.display = 'none';
  openModal('modal-app-login');
}

function applyUserPermissions() {
  const admin = state.currentUser?.role === 'Admin';
  document.querySelector('[data-view="backup"]').hidden = !admin;
  document.getElementById('tab-settings-audit').hidden = !admin;
  document.getElementById('btn-khata-edit-cust').hidden = !admin;
  document.querySelectorAll('#form-business-profile input, #form-business-profile textarea, #form-business-profile button').forEach(el => { el.disabled = !admin; });
  document.getElementById('cfg-require-login').disabled = !admin;
  document.getElementById('btn-open-new-user-modal').hidden = !admin;
  document.getElementById('table-users').hidden = !admin;
  document.getElementById('users-table-body').replaceChildren();
  document.getElementById('audit-table-body').replaceChildren();
}

async function bootApplication() {
  try {
    state.settings = await khataApi.getSettings();
    document.getElementById('sidebar-business-name').textContent = state.settings.business_name || 'Simple Khata';
    state.currentUser = await khataApi.getSession();
    applyUserPermissions();
    if (!state.currentUser) await showLogin();
    else {
      document.getElementById('current-user-name').textContent = state.currentUser.name;
      document.getElementById('current-user-role').textContent = state.currentUser.role;
      document.getElementById('current-user-avatar').textContent = state.currentUser.name.charAt(0).toUpperCase();
      navigateTo('dashboard');
      await refreshBackupStatus();
    }
    setInterval(() => { if (state.currentUser) refreshBackupStatus(); }, 60000);
  } catch (err) {
    showToast('Could not start application: ' + err.message, 'error');
  }
}

function handleDeleteUser(id) {
  openConfirmDialog('Delete User', 'Delete this system user?', async () => {
    try {
      await khataApi.deleteUser(id, state.currentUser);
      await loadUsersList();
      showToast('User deleted.');
    } catch (err) { showToast(err.message, 'error'); }
  });
}

function updateLogoPreview(logo) {
  document.getElementById('logo-preview-img').src = logo || '';
  document.getElementById('logo-preview-box').style.display = logo ? 'block' : 'none';
}

function addPrintLogo(containerId, logo) {
  const container = document.getElementById(containerId);
  container.querySelector('.business-print-logo')?.remove();
  if (!logo) return;
  const img = document.createElement('img');
  img.className = 'business-print-logo';
  img.src = logo;
  img.alt = 'Business logo';
  img.style.maxHeight = '60px';
  img.style.maxWidth = '180px';
  container.prepend(img);
}

function attachAdditionalActions() {
  document.getElementById('btn-export-report-csv').addEventListener('click', () => exportTableCsv('#report-sheet-table', 'report.csv'));
  document.getElementById('btn-export-statement-csv').addEventListener('click', () => exportTableCsv('#statement-paper table', 'statement.csv'));
  document.getElementById('btn-generate-custom-report').addEventListener('click', loadReports);
  document.getElementById('btn-open-new-user-modal').addEventListener('click', () => {
    document.getElementById('form-new-user').reset();
    openModal('modal-new-user');
  });
  document.getElementById('form-new-user').addEventListener('submit', async e => {
    e.preventDefault();
    try {
      await khataApi.createUser(document.getElementById('new-user-fullname').value.trim(), document.getElementById('new-user-username').value.trim(), document.getElementById('new-user-password').value, document.getElementById('new-user-role').value, state.currentUser);
      closeModal('modal-new-user', true);
      await loadUsersList();
      showToast('User created.');
    } catch (err) { showToast(err.message, 'error'); }
  });
  document.getElementById('btn-logout').addEventListener('click', showLogin);
  document.getElementById('form-login').addEventListener('submit', async e => {
    e.preventDefault();
    try {
      const user = await khataApi.authenticate(document.getElementById('login-username').value.trim(), document.getElementById('login-password').value);
      if (!user) throw new Error('Incorrect username or password.');
      state.currentUser = user;
      state.settings = await khataApi.getSettings();
      applyUserPermissions();
      document.getElementById('app-container').inert = false;
      document.getElementById('current-user-name').textContent = user.name;
      document.getElementById('current-user-role').textContent = user.role;
      document.getElementById('current-user-avatar').textContent = user.name.charAt(0).toUpperCase();
      closeModal('modal-app-login');
      document.getElementById('form-login').reset();
      navigateTo('dashboard');
    } catch (err) {
      const message = document.getElementById('login-error-msg');
      message.textContent = err.message;
      message.style.display = 'block';
    }
  });
  document.getElementById('cfg-logo-file').addEventListener('change', async e => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      if (!file.type.startsWith('image/')) throw new Error('Choose an image file.');
      const logo = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('Could not read image.'));
        reader.readAsDataURL(file);
      });
      await khataApi.updateSettings({ logo_base64: logo }, state.currentUser);
      updateLogoPreview(logo);
      showToast('Logo saved.');
    } catch (err) { showToast(err.message, 'error'); }
  });
  document.getElementById('btn-remove-logo').addEventListener('click', async () => {
    try {
      await khataApi.updateSettings({ logo_base64: '' }, state.currentUser);
      document.getElementById('cfg-logo-file').value = '';
      updateLogoPreview('');
      showToast('Logo removed.');
    } catch (err) { showToast(err.message, 'error'); }
  });
}

function balanceLabel(status) {
  return status === 'Receivable' ? 'Aapko lena hai (Receivable)' : status === 'Payable' ? 'Aapko dena hai (Payable)' : 'Hisaab barabar (Settled)';
}

async function openEditTransactionModal(id) {
  if (state.currentUser?.role !== 'Admin') return showToast('Only an Administrator can edit transactions.', 'error');
  if (!allowLeaveForms()) return;
  try {
    const transaction = await khataApi.getTransactionById(id);
    const customer = await khataApi.getCustomerById(transaction.customer_id);
    if (!customer) throw new Error('Customer not found.');
    state.editingTransactionId = transaction.id;
    state.transactionCustomerId = customer.id;
    document.getElementById('transaction-modal-title').textContent = `Edit ${transaction.transaction_code}`;
    document.getElementById('btn-save-transaction').textContent = 'Update Transaction (Ctrl+S)';
    const select = document.getElementById('trx-customer-select');
    select.innerHTML = `<option value="${customer.id}" data-currency="${customer.currency}" data-balance="${customer.balance_cents}" data-status="${customer.status}">${escapeHtml(customer.account_code)} — ${escapeHtml(customer.name)}</option>`;
    select.disabled = true;
    select.title = 'Customer is locked to this transaction.';
    const isDebit = transaction.transaction_type === 'Debit';
    document.getElementById('trx-debit').value = isDebit ? (transaction.amount / 100).toFixed(2) : '';
    document.getElementById('trx-credit').value = !isDebit ? (transaction.amount / 100).toFixed(2) : '';
    document.getElementById('trx-date').value = transaction.transaction_date || '';
    document.getElementById('trx-details').value = transaction.description || '';
    handleTrxCustomerSelectChange();
    openModal('modal-new-transaction');
  } catch (err) { showToast('Could not open transaction: ' + err.message, 'error'); }
}

async function loadTransactionCustomers() {
  try {
    const customers = await khataApi.getCustomers('', true);
    const select = document.getElementById('filter-trx-customer');
    const selected = select.value;
    select.innerHTML = '<option value="">All customers</option>' + customers.map(c => `<option value="${c.id}">${escapeHtml(c.account_code)} — ${escapeHtml(c.name)}${c.is_archived ? ' (Archived)' : ''}</option>`).join('');
    select.value = selected;
  } catch (err) { showToast(err.message, 'error'); }
}

async function refreshBackupStatus() {
  try {
    const status = await khataApi.getBackupStatus();
    const displayTime = value => value ? new Date(value).toLocaleString() : 'No successful backup yet';
    document.getElementById('backup-last-success').textContent = displayTime(status.lastSuccessAt);
    document.getElementById('backup-next-due').textContent = status.frequency === 'Manual Only' ? 'Manual backups only' : status.nextBackupAt ? displayTime(status.nextBackupAt) : 'Due now';
    const message = status.lastError ? `Backup failed: ${status.lastError}` : status.overdue ? 'Backup is due. It will retry automatically while the app is open.' : !status.lastSuccessAt ? 'No backup found. Create your first backup.' : 'Backup is up to date';
    document.getElementById('backup-status-text').textContent = message;
    document.getElementById('backup-reminder').hidden = Boolean(status.lastSuccessAt && !status.overdue && !status.lastError);
    document.getElementById('backup-reminder-text').textContent = message;
  } catch (err) {
    document.getElementById('backup-status-text').textContent = 'Could not check backups: ' + err.message;
    document.getElementById('backup-reminder').hidden = false;
    document.getElementById('backup-reminder-text').textContent = 'Backup status unavailable. Open Backup & Restore to retry.';
  }
}

const formSnapshots = new Map();
function formValues(id) {
  return [...(document.getElementById(id)?.querySelectorAll('input:not([type=file]), select, textarea') || [])].map(el => ({ id: el.id, value: el.value, checked: el.checked }));
}
function rememberForm(id) { if (id !== 'modal-app-login' && formValues(id).length) formSnapshots.set(id, JSON.stringify(formValues(id))); }
function isFormDirty(id) { return formSnapshots.has(id) && formSnapshots.get(id) !== JSON.stringify(formValues(id)); }
function allowDiscard(id) {
  if (!isFormDirty(id)) return true;
  if (!window.confirm('Unsaved changes will be lost. Discard changes and continue?')) return false;
  for (const value of JSON.parse(formSnapshots.get(id))) {
    const el = document.getElementById(value.id);
    if (el) { el.value = value.value; if (value.checked !== undefined) el.checked = value.checked; }
  }
  return true;
}
function visibleEditors() {
  return [state.activeModal, 'form-business-profile', 'form-change-password'].filter(id => id && document.getElementById(id)?.getClientRects().length);
}
function allowLeaveForms() {
  if (state.savingTransaction || state.savingCustomer || state.savingPassword) return false;
  for (const id of visibleEditors()) if (!allowDiscard(id)) return false;
  if (state.activeModal && state.activeModal !== 'modal-app-login') closeModal(state.activeModal, true);
  return true;
}

function attachImprovementActions() {
  for (const id of ['filter-trx-customer', 'filter-trx-payment', 'filter-trx-min', 'filter-trx-max']) document.getElementById(id).addEventListener('change', loadTransactions);
  document.getElementById('form-change-password').addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.target;
    if (state.savingPassword || !form.reportValidity()) return;
    const result = document.getElementById('password-result');
    const newPassword = document.getElementById('password-new').value;
    if (newPassword !== document.getElementById('password-confirm').value) { result.textContent = 'New passwords do not match.'; return; }
    const button = document.getElementById('btn-change-password');
    state.savingPassword = true;
    button.disabled = true;
    try {
      await khataApi.changePassword(document.getElementById('password-current').value, newPassword, state.currentUser);
      form.reset();
      rememberForm('form-change-password');
      result.textContent = 'Password changed. Use your new password next time you sign in.';
      showToast('Password changed successfully.');
    } catch (err) { result.textContent = err.message; }
    finally { state.savingPassword = false; button.disabled = false; }
  });
  window.addEventListener('beforeunload', event => {
    if (visibleEditors().some(isFormDirty) || state.savingTransaction || state.savingCustomer || state.savingPassword) {
      event.preventDefault();
      event.returnValue = '';
    }
  });
}

// Bootstrap
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}



// Google Drive is available through the desktop's protected credential store only.
let driveUiBusy = false;
async function loadDriveStatus() {
  const supported = typeof khataApi.getDriveStatus === 'function';
  const admin = state.currentUser?.role === 'Admin';
  const message = document.getElementById('drive-status-text');
  try {
    const status = supported ? await khataApi.getDriveStatus() : null;
    const connected = Boolean(status?.connected);
    document.getElementById('drive-account-email').textContent = connected ? status.accountEmail || 'Connected — reconnect to confirm the email address' : 'No Google account connected';
    document.getElementById('drive-connection-badge').textContent = connected ? 'Connected' : 'Not connected';
    document.getElementById('drive-connection-badge').className = 'badge ' + (connected ? 'badge-receivable' : 'badge-zero');
    document.getElementById('drive-last-success').textContent = status?.lastSuccessAt ? new Date(status.lastSuccessAt).toLocaleString() : 'Not backed up yet';
    document.getElementById('drive-pending').textContent = status?.pending ?? 0;
    message.textContent = !supported ? 'Open the Windows desktop app to connect Google Drive.' : !admin ? 'An administrator can manage this connection.' : driveUiBusy || status.busy ? 'Working… Complete Google sign-in in your browser.' : status.lastError || (connected ? status.pending ? 'Waiting to upload; retries while the app is open.' : 'Ready for backup' : status.configured ? 'Choose your Google account to start backing up' : 'Google sign-in setup is missing. Open Advanced setup.');
    const blocked = !supported || !admin || driveUiBusy || Boolean(status?.busy);
    document.getElementById('btn-drive-connect').disabled = blocked || connected || !status?.configured;
    document.getElementById('btn-drive-connect').hidden = connected;
    const switchButton = document.getElementById('btn-drive-switch');
    switchButton.hidden = !connected;
    switchButton.disabled = blocked || !connected;
    switchButton.textContent = status?.needsReconnect ? 'Reconnect Google Account' : 'Change Google Account';
    document.getElementById('btn-drive-import').disabled = blocked || connected;
    for (const id of ['btn-drive-backup', 'btn-drive-list']) document.getElementById(id).disabled = blocked || !connected || Boolean(status?.needsReconnect);
    document.getElementById('btn-drive-disconnect').disabled = blocked || !connected;
    document.getElementById('btn-drive-setup').disabled = !supported || !admin;
    if (supported && !status.configured) document.getElementById('drive-setup-guide').open = true;
  } catch (err) { message.textContent = 'Could not check Google Drive: ' + err.message; }
}

async function runDriveAction(action) {
  if (driveUiBusy) return;
  driveUiBusy = true;
  await loadDriveStatus();
  try { await action(); }
  catch (err) { showToast(err.message, 'error'); }
  finally { driveUiBusy = false; await loadDriveStatus(); }
}

function bindDriveBackupControls() {
  document.getElementById('btn-drive-setup').addEventListener('click', () => runDriveAction(() => khataApi.openDriveSetup()));
  document.getElementById('btn-drive-import').addEventListener('click', () => runDriveAction(async () => {
    if (await khataApi.importDriveCredentials(state.currentUser)) showToast('Google setup imported. You can now connect your account.');
  }));
  document.getElementById('btn-drive-connect').addEventListener('click', () => runDriveAction(async () => {
    await khataApi.connectDrive(state.currentUser);
    document.getElementById('drive-setup-guide').open = false;
    showToast('Google Drive connected. Click Back Up to Drive Now for your first upload.');
  }));
  document.getElementById('btn-drive-switch').addEventListener('click', () => openConfirmDialog('Change Google Account', 'Choose a Google account in your browser. Pending backups for the previous account will be kept locally and will not be uploaded to the new account. Cancelling sign-in keeps your current connection.', () => runDriveAction(async () => {
    const status = await khataApi.switchDriveAccount(state.currentUser);
    const list = document.getElementById('drive-backups-list'); list.replaceChildren(); list.hidden = true;
    showToast('Backup account connected: ' + (status.accountEmail || 'Google account'));
  })));
  document.getElementById('btn-drive-backup').addEventListener('click', () => runDriveAction(async () => {
    await khataApi.backupToDrive(state.currentUser);
    showToast('Backup uploaded to Google Drive and verified.');
    await loadBackups();
  }));
  document.getElementById('btn-drive-list').addEventListener('click', () => runDriveAction(async () => {
    const backups = await khataApi.listDriveBackups(state.currentUser);
    const list = document.getElementById('drive-backups-list');
    list.replaceChildren(); list.hidden = false;
    if (!backups.length) { list.textContent = 'No cloud backups yet. Create your first backup above.'; return; }
    for (const backup of backups) {
      const row = document.createElement('div'); row.className = 'drive-backup-row';
      const description = document.createElement('div');
      const title = document.createElement('strong'); title.textContent = backup.name;
      const detail = document.createElement('small'); detail.textContent = `${new Date(backup.createdTime).toLocaleString()} · ${(Number(backup.size) / 1024).toFixed(1)} KB`;
      description.append(title, detail);
      const button = document.createElement('button'); button.type = 'button'; button.className = 'btn btn-outline btn-sm'; button.textContent = 'Restore';
      button.addEventListener('click', () => openConfirmDialog('Restore Google Drive Backup', `Replace current records with ${backup.name}? A local safety copy will be created first.`, () => runDriveAction(async () => {
        await khataApi.restoreDriveBackup(backup.id, state.currentUser);
        showToast('Google Drive backup restored. Reloading…');
        setTimeout(() => window.location.reload(), 1200);
      })));
      row.append(description, button); list.append(row);
    }
  }));
  document.getElementById('btn-drive-disconnect').addEventListener('click', () => openConfirmDialog('Disconnect Google Drive', 'Stop cloud uploads on this computer? Existing local and uploaded backups will be kept. Pending cloud copies will be removed from the upload queue.', () => runDriveAction(async () => {
    await khataApi.disconnectDrive(state.currentUser);
    const list = document.getElementById('drive-backups-list'); list.replaceChildren(); list.hidden = true;
    showToast('Google Drive disconnected.');
  })));
  setInterval(() => { if (state.activeView === 'backup' && !driveUiBusy) loadDriveStatus(); }, 15000);
}

// --- Auto-Update Notification ---
if (window.api && window.api.onUpdateAvailable) {
  window.api.onUpdateAvailable((info) => {
    const banner = document.getElementById('update-banner');
    const text = document.getElementById('update-banner-text');
    if (banner && text) {
      text.textContent = 'Naya version v' + info.version + ' available hai! Abhi download karo.';
      banner.style.display = 'flex';
    }
  });
}

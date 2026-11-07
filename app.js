/* =======================================================
   Vider Finance – Main Application Logic
   Business Rules:
   - Loan interest: 20% per 10 days
   - Pawn interest: 5% per 10 days
   Data stored in localStorage (no backend required)
   ======================================================= */

'use strict';


// ============================================================
// Authentication System
// ============================================================
const MANAGERS = {
  "1709901591262": "ภาณุเดช พุทธบัวงาม",
  "1679900120330": "เพ็ญนภา เบ้าอาสา"
};

function checkAuth() {
  const managerName = sessionStorage.getItem('vider_manager');
  const loginScreen = document.getElementById('loginScreen');
  const mainAppContainer = document.getElementById('mainAppContainer');
  
  if (managerName) {
    if (loginScreen) loginScreen.style.display = 'none';
    if (mainAppContainer) mainAppContainer.style.display = 'flex';
  } else {
    if (loginScreen) loginScreen.style.display = 'flex';
    if (mainAppContainer) mainAppContainer.style.display = 'none';
  }
}

// Check auth on load
checkAuth();

document.addEventListener('DOMContentLoaded', () => {
  const loginBtn = document.getElementById('loginBtn');
  const loginInput = document.getElementById('managerIdInput');
  const logoutBtn = document.getElementById('nav-logout');
  
  if (loginBtn && loginInput) {
    const handleLogin = () => {
      const id = loginInput.value.trim();
      if (MANAGERS[id]) {
        sessionStorage.setItem('vider_manager', MANAGERS[id]);
        showToast('ยินดีต้อนรับ ' + MANAGERS[id]);
        checkAuth();
        triggerRender();
      } else {
        showToast('หมายเลขประจำตัวไม่ถูกต้อง', 'error');
      }
    };
    loginBtn.addEventListener('click', handleLogin);
    loginInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') handleLogin();
    });
  }
  
  if (logoutBtn) {
    logoutBtn.addEventListener('click', (e) => {
      e.preventDefault();
      sessionStorage.removeItem('vider_manager');
      window.location.reload();
    });
  }
});


// ============================================================
// Constants & Config
// ============================================================
const LOAN_RATE = 0.20;   // 20% per 10 days
const PAWN_RATE = 0.05;   // 5% per 10 days
const PERIOD_DAYS = 10;

// ============================================================
// Data Store (localStorage)
// ============================================================
window.APP_DATA = {
  customers: JSON.parse(localStorage.getItem('vider_customers') || '[]'),
  loans: JSON.parse(localStorage.getItem('vider_loans') || '[]'),
  pawns: JSON.parse(localStorage.getItem('vider_pawns') || '[]'),
  daily_loans: JSON.parse(localStorage.getItem('vider_daily_loans') || '[]'),
  transactions: JSON.parse(localStorage.getItem('vider_transactions') || '[]')
};

const DB = {
  get: (key) => window.APP_DATA[key] || [],
  set: (key, val) => {
    // Use localStorage as the pristine old state, because APP_DATA might have been mutated in-place
    const oldArr = JSON.parse(localStorage.getItem('vider_' + key) || '[]');
    const newArr = val || [];
    
    // Optimistic local update & LocalStorage fallback cache
    window.APP_DATA[key] = newArr;
    localStorage.setItem('vider_' + key, JSON.stringify(newArr));
    
    if (window.firebaseDb && window.firestore) {
      const oldMap = new Map(oldArr.map(i => [i.id, i]));
      const newMap = new Map(newArr.map(i => [i.id, i]));
      
      const batch = window.firestore.writeBatch(window.firebaseDb);
      
      for (const [id, item] of oldMap) {
        if (!newMap.has(id)) {
          batch.delete(window.firestore.doc(window.firebaseDb, key, id));
        }
      }
      for (const [id, item] of newMap) {
        const oldItem = oldMap.get(id);
        if (!oldItem || JSON.stringify(oldItem) !== JSON.stringify(item)) {
          batch.set(window.firestore.doc(window.firebaseDb, key, id), item);
        }
      }
      
      batch.commit().catch(e => {
        console.error('Firestore sync err:', e);
        if (typeof showToast === 'function') showToast('ออฟไลน์: บันทึกลงเครื่องแล้ว', 'error');
      });
    }
  }
};

let renderTimeout;
function triggerRender() {
  clearTimeout(renderTimeout);
  renderTimeout = setTimeout(() => {
      if (typeof updateBadges === 'function') updateBadges();
      const activeNav = document.querySelector('.nav-item.active');
      if (activeNav) {
         const page = activeNav.dataset.page;
         if (page === 'dashboard') renderDashboard();
         else if (page === 'customers') renderCustomers(document.getElementById('customerSearch').value);
         else if (page === 'loans') renderLoans(document.getElementById('loanSearch').value, document.getElementById('loanStatusFilter').value);
         else if (page === 'daily') renderDaily(document.getElementById('dailySearch').value, document.getElementById('dailyStatusFilter').value);
         else if (page === 'pawns') renderPawns(document.getElementById('pawnSearch').value, document.getElementById('pawnStatusFilter').value);
         else if (page === 'transactions') renderTransactions();
         else if (page === 'reports') renderReportPage();
      }
  }, 100);
}

window.addEventListener('firebaseReady', async () => {
  const collections = ['customers', 'loans', 'pawns', 'daily_loans', 'transactions'];
  let totalDocs = 0;
  
  try {
    const snapshots = await Promise.all(
      collections.map(col => window.firestore.getDocs(window.firestore.collection(window.firebaseDb, col)))
    );
    
    snapshots.forEach((snap, idx) => {
      totalDocs += snap.size;
      window.APP_DATA[collections[idx]] = snap.docs.map(d => d.data());
    });

    if (true) {
      console.log("Syncing LocalStorage to Firestore (Merge)...");
      const batch = window.firestore.writeBatch(window.firebaseDb);
      let needsMigration = false;
      collections.forEach(col => {
        const localData = JSON.parse(localStorage.getItem('vider_' + col) || '[]');
        const cloudMap = new Map(window.APP_DATA[col].map(i => [i.id, i]));
        
        localData.forEach(item => {
          if (!cloudMap.has(item.id)) {
            batch.set(window.firestore.doc(window.firebaseDb, col, item.id), item);
            window.APP_DATA[col].push(item);
            needsMigration = true;
          }
        });
      });
      if (needsMigration) {
        await batch.commit().catch(e => console.error("Migration blocked by rules:", e));
        console.log("Migration synced!");
      }
    }

    // Set up real-time listeners
    collections.forEach(col => {
      window.firestore.onSnapshot(window.firestore.collection(window.firebaseDb, col), (snap) => {
        const serverData = snap.docs.map(d => d.data());
        // Prevent wiping local data if server unexpectedly returns empty (e.g. rules blocked migration)
        if (serverData.length === 0 && window.APP_DATA[col] && window.APP_DATA[col].length > 0) {
          console.warn('Server returned empty for ' + col + ' - preserving local data');
          return;
        }
        window.APP_DATA[col] = serverData;
        localStorage.setItem('vider_' + col, JSON.stringify(window.APP_DATA[col]));
        triggerRender();
      });
    });

    // Hide loader
    const loader = document.getElementById('appLoadingOverlay');
    if (loader) loader.style.display = 'none';

    // Initial render
    triggerRender();

  } catch (err) {
    console.error("Firebase Initialization Error:", err);
    // Hide loader and let them use the app offline with LocalStorage data
    const loader = document.getElementById('appLoadingOverlay');
    if (loader) loader.style.display = 'none';
    triggerRender();
    if (typeof showToast === 'function') showToast('โหมดออฟไลน์: ไม่สามารถเชื่อมต่อคลาวด์ได้', 'error');
  }
});


function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// Helpers
function today() {
  return new Date().toISOString().slice(0, 10);
}

function addDays(dateStr, days) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function daysBetween(d1, d2) {
  const ms = new Date(d2) - new Date(d1);
  return Math.floor(ms / 86400000);
}

function formatMoney(n) {
  return '฿' + Number(n || 0).toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function formatDate(d) {
  if (!d) return '-';
  const [y, m, day] = d.split('-');
  return `${parseInt(day)}/${parseInt(m)}/${parseInt(y) + 543}`;
}

/** Calculate accrued interest for a contract (total periods elapsed) */
function calcAccruedInterest(startDate, rate, principal) {
  const days = daysBetween(startDate, endDate);
  if (days <= 0) return 0;
  const periods = Math.floor(days / PERIOD_DAYS);
  return periods * (principal * rate);
}

/** Calculate periods elapsed since contract start */
function calcPeriods(startDate, endDate = today()) {
  const days = daysBetween(startDate, today());
  return Math.max(0, Math.floor(days / PERIOD_DAYS));
}

/**
 * Calculate UNPAID interest = (elapsed - paid) * principal * rate
 * paidPeriods defaults to 0 for legacy records
 */
function calcUnpaidInterest(item) {
  if (item._loanDefault) {
    const endDate = item.status === 'paid' && item.closedDate ? item.closedDate : today();
    const days = Math.max(0, daysBetween(item.date, endDate));
    const rate = item.rate || LOAN_RATE;
    const dailyInterest = item.amount * (rate / 10);
    const totalAccrued = dailyInterest * days;
    const legacyPaid = (item.paidPeriods || 0) * (item.amount * rate);
    const totalPaid = item.paidInterest !== undefined ? item.paidInterest : legacyPaid;
    return Math.max(0, totalAccrued - totalPaid);
  }
  
  const endDate = (item.status === 'paid' || item.status === 'redeemed' || item.status === 'forfeited') && item.closedDate ? item.closedDate : today();
  const elapsed = calcPeriods(item.date, endDate);
  const rate = item.rate || PAWN_RATE;
  const interestPerPeriod = item.amount * rate;
  const accrued = elapsed * interestPerPeriod;
  const legacyPaid = (item.paidPeriods || 0) * interestPerPeriod;
  const totalPaid = item.paidInterest !== undefined ? item.paidInterest : legacyPaid;
  return Math.max(0, accrued - totalPaid);
}

function nextDueDate(item) {
  if (item._loanDefault) {
    const rate = item.rate || LOAN_RATE;
    const dailyInterest = item.amount * (rate / 10);
    const legacyPaid = (item.paidPeriods || 0) * (item.amount * rate);
    const totalPaid = item.paidInterest !== undefined ? item.paidInterest : legacyPaid;
    const equivalentDaysPaid = dailyInterest > 0 ? Math.floor(totalPaid / dailyInterest) : 0;
    return addDays(item.date, equivalentDaysPaid + PERIOD_DAYS);
  }
  
  const rate = item.rate || PAWN_RATE;
  const interestPerPeriod = item.amount * rate;
  const legacyPaid = (item.paidPeriods || 0) * interestPerPeriod;
  const totalPaid = item.paidInterest !== undefined ? item.paidInterest : legacyPaid;
  const paid = interestPerPeriod > 0 ? Math.floor(totalPaid / interestPerPeriod) : 0;
  return addDays(item.date, (paid + 1) * PERIOD_DAYS);
}

function getContractStatus(item) {
  if (['paid', 'redeemed', 'forfeited'].includes(item.status)) return item.status;
  
  if (item._loanDefault) {
    const unpaid = calcUnpaidInterest(item);
    return unpaid > 0 ? 'overdue' : 'active';
  }
  
  const due = nextDueDate(item);
  const todayDate = new Date(today());
  const dueDate = new Date(due);
  return todayDate > dueDate ? 'overdue' : 'active';
}


// ============================================================
// Toast Notification
// ============================================================
function showToast(msg, type = 'success') {
  const icons = { success: '✅', error: '❌', info: 'ℹ️' };
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = `${icons[type] || ''} ${msg}`;
  document.getElementById('toastContainer').appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

// ============================================================
// Navigation
// ============================================================
function navigateTo(page) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));

  const pageEl = document.getElementById('page-' + page);
  const navEl = document.getElementById('nav-' + page);
  if (pageEl) pageEl.classList.add('active');
  if (navEl) navEl.classList.add('active');

  const titles = {
    dashboard: 'แดชบอร์ด',
    customers: 'จัดการลูกค้า',
    loans: 'จัดการกู้ดอกสะสมรายวัน',
    daily: 'จัดการเงินกู้รายวัน',
    pawns: 'จัดการจำนำ',
    transactions: 'รายการทั้งหมด',
    reports: 'รายงาน',
  };
  document.getElementById('topbarTitle').textContent = titles[page] || page;

  // Refresh the relevant page
  if (page === 'dashboard') renderDashboard();
  else if (page === 'customers') renderCustomers();
  else if (page === 'loans') renderLoans();
  else if (page === 'daily') renderDaily();
  else if (page === 'pawns') renderPawns();
  else if (page === 'transactions') renderTransactions();
  else if (page === 'reports') initReportPage();

  updateBadges();
}

// ============================================================
// Sidebar
// ============================================================
const sidebar = document.getElementById('sidebar');
const mainContent = document.getElementById('mainContent');

document.getElementById('sidebarToggle').addEventListener('click', () => {
  sidebar.classList.toggle('collapsed');
  mainContent.classList.toggle('sidebar-collapsed');
});

document.getElementById('menuBtn').addEventListener('click', () => {
  sidebar.classList.toggle('mobile-open');
});

document.querySelectorAll('.nav-item').forEach(item => {
  item.addEventListener('click', (e) => {
    e.preventDefault();
    navigateTo(item.dataset.page);
    if (window.innerWidth < 1024) sidebar.classList.remove('mobile-open');
  });
});

// ============================================================
// Dashboard
// ============================================================
function renderDashboard() {
  const loans = DB.get('loans').filter(l => !['paid'].includes(l.status));
  const pawns = DB.get('pawns').filter(p => !['redeemed','forfeited'].includes(p.status));
  const dailyLoans = DB.get('daily_loans').filter(d => d.status !== 'paid');
  const txs = DB.get('transactions');

  // Totals
  const totalLoan = loans.reduce((s, l) => s + (l.amount || 0), 0);
  const totalPawn = pawns.reduce((s, p) => s + (p.amount || 0), 0);
  const totalDaily = dailyLoans.reduce((s, d) => s + (d.amount || 0), 0);

  // Unpaid interest (what's outstanding right now)
  const loanInterest = loans.reduce((s, l) => s + calcUnpaidInterest({ ...l, _loanDefault: true }), 0);
  const pawnInterest = pawns.reduce((s, p) => s + calcUnpaidInterest(p), 0);
  
  // Unpaid interest for daily loans = total interest - paid interest
  const dailyInterest = dailyLoans.reduce((s, d) => {
    const totalInt = d.amount * d.rate;
    const paidInt = d.totalAmount ? ((d.paidAmount || 0) * (totalInt / d.totalAmount)) : 0;
    return s + (totalInt - paidInt);
  }, 0) || 0;
  const totalInterest = loanInterest + pawnInterest + dailyInterest;

  // Actual collected interest from transactions
  const collectedInterest = txs.filter(t => t.type === 'interest').reduce((s, t) => s + t.amount, 0);
  const collectedDailyInterest = txs.filter(t => t.type === 'daily_payment').reduce((s, t) => s + (t.interestAmount || 0), 0);
  const expenses = txs.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
  const profit = collectedInterest + collectedDailyInterest - expenses;
  const collectedIncome = txs.filter(t => t.type !== 'expense').reduce((s, t) => s + t.amount, 0);

  document.getElementById('kpi-profit').textContent = formatMoney(profit);
  document.getElementById('kpi-total-income').textContent = formatMoney(collectedIncome);
  document.getElementById('kpi-income').textContent = formatMoney(totalInterest);
  document.getElementById('kpi-income-sub').textContent = 'ดอกค้างรับทั้งหมด';
  document.getElementById('kpi-loans').textContent = formatMoney(totalLoan + totalDaily);
  document.getElementById('kpi-loans-count').textContent = `${loans.length + dailyLoans.length} สัญญา`;
  document.getElementById('kpi-pawns').textContent = formatMoney(totalPawn);
  document.getElementById('kpi-pawns-count').textContent = `${pawns.length} รายการ`;

  document.getElementById('dashDate').textContent = formatDate(today());

  // Due items: contracts where next-due is within 3 days OR already overdue
  const dueList = document.getElementById('dueList');
  const dueCount = document.getElementById('due-count');
  const customers = DB.get('customers');
  const dueItems = [];

  [
    ...loans.map(l => ({ ...l, _type: 'loan' })),
    ...pawns.map(p => ({ ...p, _type: 'pawn' }))
  ].forEach(item => {
    const due = nextDueDate(item);
    const daysLeft = daysBetween(today(), due);
    const liveStatus = getContractStatus(item);
    if (daysLeft <= 3 || liveStatus === 'overdue') {
      dueItems.push({ ...item, due, daysLeft, liveStatus });
    }
  });

  dailyLoans.forEach(item => {
    const elapsedDays = daysBetween(item.date, today());
    // calculate expected paid up to yesterday (to not penalize today prematurely) or today
    // Let's use elapsedDays. If it's day 1 (tomorrow), elapsedDays = 1.
    const expectedPaid = Math.min(item.totalAmount, elapsedDays * item.dailyInstallment);
    const actualPaid = item.paidAmount || 0;
    
    if (actualPaid < expectedPaid || elapsedDays >= 0 && actualPaid < item.totalAmount) {
      const isOverdue = actualPaid < expectedPaid;
      const daysLeft = Math.max(0, item.durationDays - elapsedDays);
      const dueInterest = expectedPaid - actualPaid; // Amount needed to catch up
      
      // If overdue or due today
      if (dueInterest > 0 || (elapsedDays >= 0 && actualPaid < item.totalAmount)) {
         dueItems.push({
           ...item,
           _type: 'daily',
           due: addDays(item.date, elapsedDays), 
           daysLeft: isOverdue ? -1 : 0,
           liveStatus: isOverdue ? 'overdue' : 'active',
           displayAmount: dueInterest > 0 ? dueInterest : item.dailyInstallment
         });
      }
    }
  });

  dueCount.textContent = `${dueItems.length} รายการ`;
  if (dueItems.length === 0) {
    dueList.innerHTML = '<div class="empty-state">ไม่มีรายการที่ครบกำหนดใน 3 วัน</div>';
  } else {
    dueList.innerHTML = dueItems.map(item => {
      const cust = customers.find(c => c.id === item.customerId);
      const name = cust ? cust.name : 'ไม่ระบุ';
      const rate = item.rate || (item._type === 'loan' ? LOAN_RATE : PAWN_RATE);
      let dueAmount = 0;
      let typeLabel = '';
      if (item._type === 'daily') {
        typeLabel = 'กู้รายวัน';
        dueAmount = item.displayAmount;
      } else {
        typeLabel = item._type === 'loan' ? 'เงินกู้' : 'จำนำ';
        dueAmount = calcUnpaidInterest({ ...item, _loanDefault: item._type === 'loan' }) || item.amount * rate;
      }
      const overdue = item.liveStatus === 'overdue';
      return `
        <div class="due-item ${overdue ? 'overdue' : ''}">
          <div>
            <div class="name">${name} – ${typeLabel}</div>
            <div class="info">
              ${item._type === 'pawn' ? item.item + ' | ' : ''}
              ${item._type === 'daily' ? 'รายวัน' : `ครบ: ${formatDate(item.due)}`}
              ${overdue
                ? `<span style="color:var(--accent-rose)">(ค้างชำระ)</span>`
                : (item._type === 'daily' ? '' : `(อีก ${item.daysLeft} วัน)`)
              }
            </div>
          </div>
          <div class="amount">${formatMoney(dueAmount)}</div>
        </div>`;
    }).join('');
  }

  // Recent transactions
  const recentList = document.getElementById('recentList');
  const recent = [...txs].sort((a, b) => b.createdAt - a.createdAt).slice(0, 6);
  if (recent.length === 0) {
    recentList.innerHTML = '<div class="empty-state">ยังไม่มีรายการ</div>';
  } else {
    const typeLabels = { interest: 'รับดอก', daily_payment: 'รับรายวัน', loan_payment: 'คืนเงินกู้', pawn_redeem: 'ไถ่จำนำ', expense: 'รายจ่าย' };
    const typeBadges = { interest: 'badge-interest', daily_payment: 'badge-loan', loan_payment: 'badge-loan', pawn_redeem: 'badge-pawn', expense: 'badge-expense' };
    recentList.innerHTML = recent.map(tx => {
      const cust = customers.find(c => c.id === tx.customerId);
      return `
        <div class="recent-item">
          <div>
            <span class="type-badge ${typeBadges[tx.type] || ''}">${typeLabels[tx.type] || tx.type}</span>
            ${cust ? ' ' + cust.name : ''}
          </div>
          <span style="color:${tx.type === 'expense' ? 'var(--accent-rose)' : 'var(--accent-emerald)'}; font-weight:600">
            ${tx.type === 'expense' ? '-' : '+'}${formatMoney(tx.amount)}
          </span>
        </div>`;
    }).join('');
  }

  // Portfolio bars
  const total = totalLoan + totalPawn + totalDaily || 1;
  const loanPct = Math.round((totalLoan / total) * 100);
  const pawnPct = Math.round((totalPawn / total) * 100);
  const dailyPct = Math.round((totalDaily / total) * 100);
  document.getElementById('loanBar').style.width = loanPct + '%';
  document.getElementById('pawnBar').style.width = pawnPct + '%';
  document.getElementById('dailyBar').style.width = dailyPct + '%';
  document.getElementById('loanBarAmount').textContent = formatMoney(totalLoan);
  document.getElementById('pawnBarAmount').textContent = formatMoney(totalPawn);
  document.getElementById('dailyBarAmount').textContent = formatMoney(totalDaily);
}

// ============================================================
// Badges
// ============================================================
function updateBadges() {
  const loans = DB.get('loans').filter(l => !['paid'].includes(l.status));
  const dailyLoans = DB.get('daily_loans').filter(d => d.status !== 'paid');
  const pawns = DB.get('pawns').filter(p => !['redeemed','forfeited'].includes(p.status));
  const customers = DB.get('customers');

  document.getElementById('badge-customers').textContent = customers.length;
  document.getElementById('badge-loans').textContent = loans.length;
  document.getElementById('badge-daily').textContent = dailyLoans.length;
  document.getElementById('badge-pawns').textContent = pawns.length;
}

// ============================================================
// Customers
// ============================================================
function renderCustomers(filter = '') {
  let customers = DB.get('customers');
  const loans = DB.get('loans');
  const pawns = DB.get('pawns');
  const dailyLoans = DB.get('daily_loans');

  if (filter) {
    const q = filter.toLowerCase();
    customers = customers.filter(c =>
      c.name.toLowerCase().includes(q) ||
      (c.phone || '').includes(q) ||
      (c.idCard || '').includes(q)
    );
  }

  const tbody = document.getElementById('customerTableBody');
  if (customers.length === 0) {
    tbody.innerHTML = '<tr class="empty-row"><td colspan="10">ยังไม่มีลูกค้า</td></tr>';
    return;
  }

  tbody.innerHTML = customers.map((c, i) => {
    const cLoans = loans.filter(l => l.customerId === c.id && (l.status === 'active' || l.status === 'overdue'));
    const cPawns = pawns.filter(p => p.customerId === c.id && (p.status === 'active' || p.status === 'overdue'));
    const cDaily = dailyLoans.filter(d => d.customerId === c.id && d.status !== 'paid');
    
    const loanTotal = cLoans.reduce((s, l) => s + l.amount, 0);
    const pawnTotal = cPawns.reduce((s, p) => s + p.amount, 0);
    const dailyTotal = cDaily.reduce((s, d) => s + d.amount, 0);
    
    const hasActive = cLoans.length > 0 || cPawns.length > 0 || cDaily.length > 0;
    return `
      <tr>
        <td>${i + 1}</td>
        <td><strong>${c.name}</strong></td>
        <td>${c.phone || '-'}</td>
        <td style="max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${c.address || ''}">${c.address || '-'}</td>
        <td>${c.idCard || '-'}</td>
        <td style="color:var(--accent-rose);font-weight:600">${loanTotal > 0 ? formatMoney(loanTotal) : '-'}</td>
        <td style="color:var(--accent-blue);font-weight:600">${pawnTotal > 0 ? formatMoney(pawnTotal) : '-'}</td>
        <td style="color:var(--accent-purple);font-weight:600">${dailyTotal > 0 ? formatMoney(dailyTotal) : '-'}</td>
        <td><span class="type-badge ${hasActive ? 'badge-active' : 'badge-paid'}">${hasActive ? 'มีสัญญา' : 'ไม่มีสัญญา'}</span></td>
        <td>
          <div class="action-btns">
            <button class="btn-icon" title="ดูรายละเอียด" onclick="viewCustomerDetails('${c.id}')">📊</button>
            <button class="btn-icon edit" title="แก้ไข" onclick="editCustomer('${c.id}')">✏️</button>
            <button class="btn-icon delete" title="ลบ" onclick="deleteCustomer('${c.id}')">🗑️</button>
          </div>
        </td>
      </tr>`;
  }).join('');
}

document.getElementById('customerSearch').addEventListener('input', (e) => {
  renderCustomers(e.target.value);
});

document.getElementById('addCustomerBtn').addEventListener('click', () => openCustomerModal());

function openCustomerModal(data = null) {
  const modal = document.getElementById('customerModal');
  document.getElementById('customerModalTitle').textContent = data ? 'แก้ไขลูกค้า' : 'เพิ่มลูกค้า';
  document.getElementById('customerId').value = data?.id || '';
  document.getElementById('customerName').value = data?.name || '';
  document.getElementById('customerPhone').value = data?.phone || '';
  document.getElementById('customerIdCard').value = data?.idCard || '';
  document.getElementById('customerLine').value = data?.line || '';
  document.getElementById('customerAddress').value = data?.address || '';
  document.getElementById('customerNote').value = data?.note || '';
  modal.showModal();
}

document.getElementById('closeCustomerModal').addEventListener('click', () => document.getElementById('customerModal').close());
document.getElementById('cancelCustomer').addEventListener('click', () => document.getElementById('customerModal').close());

document.getElementById('customerForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const id = document.getElementById('customerId').value || genId();
  const customers = DB.get('customers');
  const existing = customers.findIndex(c => c.id === id);
  const data = {
    id,
    name: document.getElementById('customerName').value.trim(),
    phone: document.getElementById('customerPhone').value.trim(),
    idCard: document.getElementById('customerIdCard').value.trim(),
    line: document.getElementById('customerLine').value.trim(),
    address: document.getElementById('customerAddress').value.trim(),
    note: document.getElementById('customerNote').value.trim(),
    createdAt: existing >= 0 ? customers[existing].createdAt : Date.now(),
  };

  if (!data.name || !data.phone) { showToast('กรุณากรอกชื่อและเบอร์โทร', 'error'); return; }

  if (existing >= 0) customers[existing] = data;
  else customers.push(data);
  DB.set('customers', customers);

  document.getElementById('customerModal').close();
  renderCustomers();
  updateBadges();
  showToast(existing >= 0 ? 'แก้ไขข้อมูลลูกค้าแล้ว' : 'เพิ่มลูกค้าแล้ว');
});

function editCustomer(id) {
  const c = DB.get('customers').find(c => c.id === id);
  if (c) openCustomerModal(c);
}

function viewCustomerDetails(id) {
  const c = DB.get('customers').find(c => c.id === id);
  if (!c) return;

  const allLoans = DB.get('loans').filter(l => l.customerId === id);
  const allPawns = DB.get('pawns').filter(p => p.customerId === id);
  const allDaily = DB.get('daily_loans').filter(d => d.customerId === id);
  
  const totalLoan = allLoans.reduce((s, l) => s + (l.amount || 0), 0);
  const totalPawn = allPawns.reduce((s, p) => s + (p.amount || 0), 0);
  const totalDaily = allDaily.reduce((s, d) => s + (d.amount || 0), 0);
  const allTimePrincipal = totalLoan + totalPawn + totalDaily;

  const txs = DB.get('transactions').filter(t => t.customerId === id);
  const totalInterest = txs.filter(t => t.type === 'interest').reduce((s, t) => s + (t.amount || 0), 0);
  const totalDailyInterest = txs.filter(t => t.type === 'daily_payment').reduce((s, t) => s + (t.interestAmount || 0), 0);
  const allTimeProfit = totalInterest + totalDailyInterest;

  document.getElementById('customerDetailsContent').innerHTML = `
    <strong>ชื่อ:</strong> ${c.name}<br>
    <strong>เบอร์โทร:</strong> ${c.phone || '-'}<br>
    <hr style="margin: 1rem 0; border: none; border-top: 1px dashed var(--border-light);">
    <strong style="color:var(--text-light)">ยอดกู้สะสมทั้งหมด (ทุกสัญญา):</strong><br>
    - กู้ดอกสะสม: ${formatMoney(totalLoan)}<br>
    - จำนำ: ${formatMoney(totalPawn)}<br>
    - กู้รายวัน: ${formatMoney(totalDaily)}<br>
    <strong>รวมยอดกู้ทั้งหมด:</strong> <span style="color:var(--accent-emerald);font-size:1.1rem">${formatMoney(allTimePrincipal)}</span><br>
    <hr style="margin: 1rem 0; border: none; border-top: 1px dashed var(--border-light);">
    <strong>กำไรที่ได้จากลูกค้ารายนี้ (เฉพาะดอกเบี้ย):</strong><br>
    <span style="color:var(--accent-purple);font-size:1.2rem;font-weight:bold">${formatMoney(allTimeProfit)}</span>
  `;

  document.getElementById('customerDetailsModal').showModal();
}

document.getElementById('closeCustomerDetailsModal').addEventListener('click', () => document.getElementById('customerDetailsModal').close());
document.getElementById('cancelCustomerDetails').addEventListener('click', () => document.getElementById('customerDetailsModal').close());

function deleteCustomer(id) {
  openConfirm('ต้องการลบข้อมูลลูกค้านี้ใช่ไหม?', () => {
    const customers = DB.get('customers').filter(c => c.id !== id);
    DB.set('customers', customers);
    renderCustomers();
    updateBadges();
    showToast('ลบลูกค้าแล้ว');
  });
}

// ============================================================
// Loans
// ============================================================
function renderLoans(filter = '', statusFilter = '') {
  let loans = DB.get('loans');
  const customers = DB.get('customers');

  if (filter) {
    const q = filter.toLowerCase();
    loans = loans.filter(l => {
      const c = customers.find(c => c.id === l.customerId);
      return (c?.name || '').toLowerCase().includes(q) || l.id.includes(q);
    });
  }

  // Compute live status before filtering
  loans = loans.map(l => ({ ...l, _liveStatus: getContractStatus({ ...l, _loanDefault: true }) }));

  if (statusFilter) loans = loans.filter(l => l._liveStatus === statusFilter);

  const tbody = document.getElementById('loanTableBody');
  if (loans.length === 0) {
    tbody.innerHTML = '<tr class="empty-row"><td colspan="10">ยังไม่มีสัญญากู้</td></tr>';
    return;
  }

  tbody.innerHTML = loans.map((l, i) => {
    const cust = customers.find(c => c.id === l.customerId);
    const rate = l.rate || LOAN_RATE;
    const dailyInterest = l.amount * (rate / 10);
    const unpaid = calcUnpaidInterest({ ...l, _loanDefault: true });
    const endDate = l.status === 'paid' && l.closedDate ? l.closedDate : today();
    const elapsedDays = Math.max(0, daysBetween(l.date, endDate));
    const due = nextDueDate({ ...l, _loanDefault: true });
    const liveStatus = l._liveStatus;
    const statusLabel = { active: 'กำลังดำเนินการ', overdue: 'เกินกำหนด', paid: 'ชำระแล้ว' };
    const statusBadge = { active: 'badge-active', overdue: 'badge-overdue', paid: 'badge-paid' };

    const totalPaid = l.paidInterest !== undefined ? l.paidInterest : ((l.paidPeriods || 0) * (l.amount * (l.rate || LOAN_RATE)));
    
    return `
      <tr>
        <td>${i + 1}</td>
        <td><strong>${cust?.name || 'ไม่ระบุ'}</strong></td>
        <td style="color:var(--accent-rose);font-weight:600">${formatMoney(l.amount)}</td>
        <td style="color:var(--accent-gold)">${formatMoney(dailyInterest)} <small style="color:var(--text-muted)">/ วัน</small></td>
        <td>${formatDate(l.date)}</td>
        <td style="color:${unpaid > 0 ? 'var(--accent-rose)' : 'var(--text-muted)'}; font-weight:600">${formatMoney(unpaid)}</td>
        <td><span style="color:var(--text-secondary)">${elapsedDays} วัน</span></td>
        <td>
          <span class="type-badge ${statusBadge[liveStatus] || 'badge-active'}">
            ${statusLabel[liveStatus] || liveStatus}
            ${liveStatus === 'paid' ? `<br><small style="font-weight:normal;opacity:0.9">(กำไร ${formatMoney(totalPaid)})</small>` : ''}
          </span>
        </td>
        <td>
          <div class="action-btns">
            ${liveStatus !== 'paid' ? `<button class="btn-icon pay" title="รับดอก" onclick="openPayInterest('loan','${l.id}')">💵</button>` : ''}
            ${liveStatus !== 'paid' ? `<button class="btn-icon redeem" title="ชำระครบ" onclick="openCloseContractModal('loan', '${l.id}')">✅</button>` : ''}
            <button class="btn-icon edit" title="แก้ไข" onclick="editLoan('${l.id}')">✏️</button>
            <button class="btn-icon delete" title="ลบ" onclick="deleteLoan('${l.id}')">🗑️</button>
          </div>
        </td>
      </tr>`;
  }).join('');
}

document.getElementById('loanSearch').addEventListener('input', (e) => {
  renderLoans(e.target.value, document.getElementById('loanStatusFilter').value);
});
document.getElementById('loanStatusFilter').addEventListener('change', (e) => {
  renderLoans(document.getElementById('loanSearch').value, e.target.value);
});
document.getElementById('addLoanBtn').addEventListener('click', () => openLoanModal());

function populateCustomerDropdowns() {
  const customers = DB.get('customers');
  const opts = '<option value="">-- เลือกลูกค้า --</option>' +
    customers.map(c => `<option value="${c.id}">${c.name} (${c.phone})</option>`).join('');
  const txOpts = '<option value="">-- ไม่ระบุ --</option>' +
    customers.map(c => `<option value="${c.id}">${c.name} (${c.phone})</option>`).join('');

  document.getElementById('loanCustomer').innerHTML = opts;
  document.getElementById('dailyCustomer').innerHTML = opts;
  document.getElementById('pawnCustomer').innerHTML = opts;
  document.getElementById('txCustomer').innerHTML = txOpts;
}

function openLoanModal(data = null) {
  populateCustomerDropdowns();
  const modal = document.getElementById('loanModal');
  document.getElementById('loanModalTitle').textContent = data ? 'แก้ไขสัญญากู้' : 'เพิ่มสัญญาเงินกู้';
  document.getElementById('loanId').value = data?.id || '';
  document.getElementById('loanCustomer').value = data?.customerId || '';
  document.getElementById('loanAmount').value = data?.amount || '';
  // Convert stored decimal rate → percentage for the input (e.g. 0.20 → 20)
  document.getElementById('loanRate').value = data?.rate != null ? +(data.rate * 100).toFixed(2) : 20;
  document.getElementById('loanDate').value = data?.date || today();
  document.getElementById('loanNote').value = data?.note || '';
  updateLoanPreview();
  modal.showModal();
}

function updateLoanPreview() {
  const amount = parseFloat(document.getElementById('loanAmount').value) || 0;
  const ratePct = parseFloat(document.getElementById('loanRate').value) || 20;
  const date = document.getElementById('loanDate').value || today();
  document.getElementById('loanInterestPreview').textContent = formatMoney(amount * (ratePct / 100));
  document.getElementById('loanDueDate').value = addDays(date, PERIOD_DAYS);
}

document.getElementById('loanAmount').addEventListener('input', updateLoanPreview);
document.getElementById('loanRate').addEventListener('input', updateLoanPreview);
document.getElementById('loanDate').addEventListener('change', updateLoanPreview);
document.getElementById('closeLoanModal').addEventListener('click', () => document.getElementById('loanModal').close());
document.getElementById('cancelLoan').addEventListener('click', () => document.getElementById('loanModal').close());

document.getElementById('loanForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const id = document.getElementById('loanId').value || genId();
  const loans = DB.get('loans');
  const existing = loans.findIndex(l => l.id === id);

  const ratePct = parseFloat(document.getElementById('loanRate').value);
  if (!ratePct || ratePct <= 0) { showToast('กรุณากรอกอัตราดอกเบี้ย', 'error'); return; }

  const amount = parseFloat(document.getElementById('loanAmount').value);
  if (!amount || amount <= 0) { showToast('กรุณากรอกจำนวนเงิน', 'error'); return; }

  const data = {
    id,
    customerId: document.getElementById('loanCustomer').value,
    amount,
    rate: ratePct / 100,         // store as decimal e.g. 0.20
    date: document.getElementById('loanDate').value,
    note: document.getElementById('loanNote').value,
    status: existing >= 0 ? loans[existing].status : 'active',
    paidPeriods: existing >= 0 ? (loans[existing].paidPeriods || 0) : 0,
    createdAt: existing >= 0 ? loans[existing].createdAt : Date.now(),
  };

  if (!data.customerId) { showToast('กรุณาเลือกลูกค้า', 'error'); return; }

  if (existing >= 0) loans[existing] = data;
  else loans.push(data);
  DB.set('loans', loans);

  document.getElementById('loanModal').close();
  renderLoans();
  updateBadges();
  showToast(existing >= 0 ? 'แก้ไขสัญญาแล้ว' : 'เพิ่มสัญญากู้แล้ว');
});

function editLoan(id) {
  const l = DB.get('loans').find(l => l.id === id);
  if (l) openLoanModal(l);
}

function deleteLoan(id) {
  openConfirm('ต้องการลบสัญญากู้นี้ใช่ไหม?', () => {
    DB.set('loans', DB.get('loans').filter(l => l.id !== id));
    renderLoans();
    updateBadges();
    showToast('ลบสัญญาแล้ว');
  });
}

let _closeContext = null;

function openCloseContractModal(type, id) {
  _closeContext = { type, id };
  document.getElementById('closeContractDate').value = today();
  document.getElementById('closeContractDetail').innerHTML = `คุณกำลังจะปิดยอดสัญญา กรุณาระบุวันที่ลูกค้าชำระเงินครบถ้วน (เพื่อหยุดการนับวันและดอกเบี้ย):`;
  document.getElementById('closeContractModal').showModal();
}

document.getElementById('closeCloseContractModal').addEventListener('click', () => document.getElementById('closeContractModal').close());
document.getElementById('cancelCloseContract').addEventListener('click', () => document.getElementById('closeContractModal').close());

document.getElementById('closeContractForm').addEventListener('submit', (e) => {
  e.preventDefault();
  if (!_closeContext) return;
  const { type, id } = _closeContext;
  const closedDate = document.getElementById('closeContractDate').value;
  
  const txs = DB.get('transactions');

  if (type === 'loan') {
    const loans = DB.get('loans');
    const idx = loans.findIndex(l => l.id === id);
    if (idx >= 0) {
      const loan = loans[idx];
      
      // Calculate unpaid interest at closing
      const rate = loan.rate || LOAN_RATE;
      const dailyInterest = loan.amount * (rate / 10);
      const days = Math.max(0, daysBetween(loan.date, closedDate));
      const totalAccrued = dailyInterest * days;
      const legacyPaid = (loan.paidPeriods || 0) * (loan.amount * rate);
      const currentPaid = loan.paidInterest !== undefined ? loan.paidInterest : legacyPaid;
      const unpaidAmount = Math.max(0, totalAccrued - currentPaid);

      if (unpaidAmount > 0) {
        loan.paidInterest = currentPaid + unpaidAmount;
        txs.push({
          id: genId() + '_int',
          date: closedDate,
          type: 'interest',
          customerId: loan.customerId,
          amount: unpaidAmount,
          note: `รับดอกเบี้ยค้างชำระตอนปิดยอด ${formatMoney(unpaidAmount)}`,
          subType: 'loan',
          refId: loan.id,
          createdAt: Date.now(),
        });
      }

      loans[idx].status = 'paid';
      loans[idx].closedDate = closedDate;
      DB.set('loans', loans);

      txs.push({
        id: genId(),
        date: closedDate,
        type: 'loan_payment',
        customerId: loan.customerId,
        refId: loan.id,
        amount: loan.amount,
        note: `คืนเงินกู้ครบ ${formatMoney(loan.amount)}`,
        createdAt: Date.now() + 1,
      });
      DB.set('transactions', txs);
      showToast('ปิดยอดเงินกู้แล้ว');
    }
  } else if (type === 'pawn') {
    const pawns = DB.get('pawns');
    const idx = pawns.findIndex(p => p.id === id);
    if (idx >= 0) {
      const pawn = pawns[idx];

      // Calculate unpaid interest at closing
      const rate = pawn.rate || PAWN_RATE;
      const interestPerPeriod = pawn.amount * rate;
      const elapsed = calcPeriods(pawn.date, closedDate);
      const accrued = elapsed * interestPerPeriod;
      const legacyPaid = (pawn.paidPeriods || 0) * interestPerPeriod;
      const currentPaid = pawn.paidInterest !== undefined ? pawn.paidInterest : legacyPaid;
      const unpaidAmount = Math.max(0, accrued - currentPaid);

      if (unpaidAmount > 0) {
        pawn.paidInterest = currentPaid + unpaidAmount;
        txs.push({
          id: genId() + '_int',
          date: closedDate,
          type: 'interest',
          customerId: pawn.customerId,
          amount: unpaidAmount,
          note: `รับดอกเบี้ยค้างชำระตอนไถ่ถอน ${formatMoney(unpaidAmount)}`,
          subType: 'pawn',
          refId: pawn.id,
          createdAt: Date.now(),
        });
      }

      pawns[idx].status = 'redeemed';
      pawns[idx].closedDate = closedDate;
      DB.set('pawns', pawns);

      txs.push({
        id: genId(),
        date: closedDate,
        type: 'pawn_redeem',
        customerId: pawn.customerId,
        refId: pawn.id,
        amount: pawn.amount,
        note: `ไถ่ถอน ${pawn.item}`,
        createdAt: Date.now() + 1,
      });
      DB.set('transactions', txs);
      showToast('บันทึกไถ่ถอนแล้ว');
    }
  }
  
  document.getElementById('closeContractModal').close();
  _closeContext = null;
  triggerRender();
});

// ============================================================
// Pawns
// ============================================================
function renderPawns(filter = '', statusFilter = '') {
  let pawns = DB.get('pawns');
  const customers = DB.get('customers');

  if (filter) {
    const q = filter.toLowerCase();
    pawns = pawns.filter(p => {
      const c = customers.find(c => c.id === p.customerId);
      return (c?.name || '').toLowerCase().includes(q) ||
        (p.item || '').toLowerCase().includes(q);
    });
  }

  // Compute live status before filtering
  pawns = pawns.map(p => ({ ...p, _liveStatus: getContractStatus(p) }));

  if (statusFilter) pawns = pawns.filter(p => p._liveStatus === statusFilter);

  const tbody = document.getElementById('pawnTableBody');
  if (pawns.length === 0) {
    tbody.innerHTML = '<tr class="empty-row"><td colspan="11">ยังไม่มีรายการจำนำ</td></tr>';
    return;
  }

  tbody.innerHTML = pawns.map((p, i) => {
    const cust = customers.find(c => c.id === p.customerId);
    const rate = p.rate || PAWN_RATE;
    const interest = p.amount * rate;
    const unpaid = calcUnpaidInterest(p);
    const endDate = (p.status === 'redeemed' || p.status === 'forfeited') && p.closedDate ? p.closedDate : today();
    const elapsed = calcPeriods(p.date, endDate);
    const paid = p.paidPeriods || 0;
    const due = nextDueDate(p);
    const liveStatus = p._liveStatus;
    const statusLabel = { active: 'กำลังดำเนินการ', overdue: 'เกินกำหนด', redeemed: 'ไถ่ถอนแล้ว', forfeited: 'หลุดจำนำ' };
    const statusBadge = { active: 'badge-active', overdue: 'badge-overdue', redeemed: 'badge-redeemed', forfeited: 'badge-forfeited' };
    
    const totalPaid = p.paidInterest !== undefined ? p.paidInterest : ((p.paidPeriods || 0) * (p.amount * (p.rate || PAWN_RATE)));

    return `
      <tr>
        <td>${i + 1}</td>
        <td><strong>${cust?.name || 'ไม่ระบุ'}</strong></td>
        <td style="max-width:130px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${p.item}">${p.item}</td>
        <td style="color:var(--accent-blue);font-weight:600">${formatMoney(p.amount)}</td>
        <td style="color:var(--accent-gold)">${formatMoney(interest)} <small style="color:var(--text-muted)">(${(rate*100).toFixed(1)}%)</small></td>
        <td>${formatDate(p.date)}</td>
        <td>${formatDate(due)}</td>
        <td style="color:${unpaid > 0 ? 'var(--accent-rose)' : 'var(--text-muted)'}; font-weight:600">${formatMoney(unpaid)}</td>
        <td><span style="color:var(--text-secondary)">${paid}/${elapsed} รอบ</span></td>
        <td>
          <span class="type-badge ${statusBadge[liveStatus] || 'badge-active'}">
            ${statusLabel[liveStatus] || liveStatus}
            ${liveStatus === 'redeemed' || liveStatus === 'forfeited' ? `<br><small style="font-weight:normal;opacity:0.9">(กำไร ${formatMoney(totalPaid)})</small>` : ''}
          </span>
        </td>
        <td>
          <div class="action-btns">
            ${liveStatus === 'active' || liveStatus === 'overdue' ? `<button class="btn-icon pay" title="รับดอก" onclick="openPayInterest('pawn','${p.id}')">💵</button>` : ''}
            ${liveStatus === 'active' || liveStatus === 'overdue' ? `<button class="btn-icon redeem" title="ไถ่ถอน" onclick="openCloseContractModal('pawn', '${p.id}')">✅</button>` : ''}
            ${liveStatus === 'active' || liveStatus === 'overdue' ? `<button class="btn-icon forfeited" title="หลุดจำนำ" onclick="markPawnForfeited('${p.id}')">🔒</button>` : ''}
            <button class="btn-icon edit" title="แก้ไข" onclick="editPawn('${p.id}')">✏️</button>
            <button class="btn-icon delete" title="ลบ" onclick="deletePawn('${p.id}')">🗑️</button>
          </div>
        </td>
      </tr>`;
  }).join('');
}

document.getElementById('pawnSearch').addEventListener('input', (e) => {
  renderPawns(e.target.value, document.getElementById('pawnStatusFilter').value);
});
document.getElementById('pawnStatusFilter').addEventListener('change', (e) => {
  renderPawns(document.getElementById('pawnSearch').value, e.target.value);
});
document.getElementById('addPawnBtn').addEventListener('click', () => openPawnModal());

function openPawnModal(data = null) {
  populateCustomerDropdowns();
  const modal = document.getElementById('pawnModal');
  document.getElementById('pawnModalTitle').textContent = data ? 'แก้ไขรายการจำนำ' : 'เพิ่มรายการจำนำ';
  document.getElementById('pawnId').value = data?.id || '';
  document.getElementById('pawnCustomer').value = data?.customerId || '';
  document.getElementById('pawnAmount').value = data?.amount || '';
  document.getElementById('pawnItem').value = data?.item || '';
  // Convert stored decimal → percentage
  document.getElementById('pawnRate').value = data?.rate != null ? +(data.rate * 100).toFixed(2) : 5;
  document.getElementById('pawnDate').value = data?.date || today();
  document.getElementById('pawnNote').value = data?.note || '';
  updatePawnPreview();
  modal.showModal();
}

function updatePawnPreview() {
  const amount = parseFloat(document.getElementById('pawnAmount').value) || 0;
  const ratePct = parseFloat(document.getElementById('pawnRate').value) || 5;
  const date = document.getElementById('pawnDate').value || today();
  document.getElementById('pawnInterestPreview').textContent = formatMoney(amount * (ratePct / 100));
  document.getElementById('pawnDueDate').value = addDays(date, PERIOD_DAYS);
}

document.getElementById('pawnAmount').addEventListener('input', updatePawnPreview);
document.getElementById('pawnRate').addEventListener('input', updatePawnPreview);
document.getElementById('pawnDate').addEventListener('change', updatePawnPreview);
document.getElementById('closePawnModal').addEventListener('click', () => document.getElementById('pawnModal').close());
document.getElementById('cancelPawn').addEventListener('click', () => document.getElementById('pawnModal').close());

document.getElementById('pawnForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const id = document.getElementById('pawnId').value || genId();
  const pawns = DB.get('pawns');
  const existing = pawns.findIndex(p => p.id === id);
  const amount = parseFloat(document.getElementById('pawnAmount').value);
  if (!amount || amount <= 0) { showToast('กรุณากรอกมูลค่าจำนำ', 'error'); return; }

  const item = document.getElementById('pawnItem').value.trim();
  if (!item) { showToast('กรุณากรอกรายการของ', 'error'); return; }

  const ratePct = parseFloat(document.getElementById('pawnRate').value);
  if (!ratePct || ratePct <= 0) { showToast('กรุณากรอกอัตราดอกเบี้ย', 'error'); return; }

  const data = {
    id,
    customerId: document.getElementById('pawnCustomer').value,
    amount,
    item,
    rate: ratePct / 100,
    date: document.getElementById('pawnDate').value,
    note: document.getElementById('pawnNote').value,
    status: existing >= 0 ? pawns[existing].status : 'active',
    paidPeriods: existing >= 0 ? (pawns[existing].paidPeriods || 0) : 0,
    createdAt: existing >= 0 ? pawns[existing].createdAt : Date.now(),
  };

  if (!data.customerId) { showToast('กรุณาเลือกลูกค้า', 'error'); return; }

  if (existing >= 0) pawns[existing] = data;
  else pawns.push(data);
  DB.set('pawns', pawns);

  document.getElementById('pawnModal').close();
  renderPawns();
  updateBadges();
  showToast(existing >= 0 ? 'แก้ไขรายการจำนำแล้ว' : 'เพิ่มรายการจำนำแล้ว');
});

function editPawn(id) {
  const p = DB.get('pawns').find(p => p.id === id);
  if (p) openPawnModal(p);
}

function deletePawn(id) {
  openConfirm('ต้องการลบรายการจำนำนี้ใช่ไหม?', () => {
    DB.set('pawns', DB.get('pawns').filter(p => p.id !== id));
    renderPawns();
    updateBadges();
    showToast('ลบรายการจำนำแล้ว');
  });
}



function markPawnForfeited(id) {
  openConfirm('ยืนยันว่าของชิ้นนี้หลุดจำนำ (ไม่มีการไถ่ถอน)?', () => {
    const pawns = DB.get('pawns');
    const idx = pawns.findIndex(p => p.id === id);
    if (idx >= 0) {
      pawns[idx].status = 'forfeited';
      DB.set('pawns', pawns);
      renderPawns();
      updateBadges();
      showToast('บันทึกหลุดจำนำแล้ว');
    }
  });
}

// ============================================================
// Pay Interest Modal
// ============================================================
let _payContext = null;

function openPayInterest(type, id) {
  const customers = DB.get('customers');
  let item;

  if (type === 'loan') {
    item = DB.get('loans').find(l => l.id === id);
  } else {
    item = DB.get('pawns').find(p => p.id === id);
  }

  if (!item) return;

  const rate = item.rate || (type === 'loan' ? LOAN_RATE : PAWN_RATE);
  const cust = customers.find(c => c.id === item.customerId);
  
  _payContext = { type, id, item };

  if (type === 'loan') {
    const dailyInterest = item.amount * (rate / 10);
    const endDate = item.status === 'paid' && item.closedDate ? item.closedDate : today();
    const days = Math.max(0, daysBetween(item.date, endDate));
    const totalAccrued = dailyInterest * days;
    const legacyPaid = (item.paidPeriods || 0) * (item.amount * rate);
    const totalPaid = item.paidInterest !== undefined ? item.paidInterest : legacyPaid;
    const unpaidAmount = Math.max(0, totalAccrued - totalPaid);
    
    document.getElementById('payDetail').innerHTML = `
      <strong>ลูกค้า:</strong> ${cust?.name || 'ไม่ระบุ'}<br>
      <strong>เงินต้น:</strong> ${formatMoney(item.amount)}<br>
      <strong>ดอกเบี้ยสะสม:</strong> ${formatMoney(dailyInterest)} / วัน<br>
      <strong>ผ่านมาแล้ว:</strong> ${days} วัน<br>
      <strong>ดอกเบี้ยที่จ่ายแล้ว:</strong> ${formatMoney(totalPaid)}<br>
      <strong>ดอกค้างทั้งหมด:</strong> <span style="color:var(--accent-gold);font-weight:700">${formatMoney(unpaidAmount)}</span>
    `;
    
    document.getElementById('payAmount').value = unpaidAmount > 0 ? unpaidAmount : dailyInterest;
  } else {
    const interestPerPeriod = item.amount * rate;
    const endDate = (item.status === 'paid' || item.status === 'redeemed' || item.status === 'forfeited') && item.closedDate ? item.closedDate : today();
    const elapsed = calcPeriods(item.date, endDate);
    const legacyPaid = (item.paidPeriods || 0) * interestPerPeriod;
    const totalPaid = item.paidInterest !== undefined ? item.paidInterest : legacyPaid;
    const accrued = elapsed * interestPerPeriod;
    const unpaidAmount = Math.max(0, accrued - totalPaid);
    
    const paidPeriodsEquivalent = interestPerPeriod > 0 ? Math.floor(totalPaid / interestPerPeriod) : 0;
    const due = addDays(item.date, (paidPeriodsEquivalent + 1) * PERIOD_DAYS);

    document.getElementById('payDetail').innerHTML = `
      <strong>ลูกค้า:</strong> ${cust?.name || 'ไม่ระบุ'}<br>
      <strong>เงินต้น:</strong> ${formatMoney(item.amount)}<br>
      <strong>อัตราดอก:</strong> ${(rate*100).toFixed(1)}% / 10 วัน → ${formatMoney(interestPerPeriod)}/รอบ<br>
      <strong>รอบที่ผ่านมา:</strong> ${elapsed} รอบ<br>
      <strong>ดอกเบี้ยที่จ่ายแล้ว:</strong> ${formatMoney(totalPaid)}<br>
      <strong>ยอดค้างทั้งหมด:</strong> <span style="color:var(--accent-gold);font-weight:700">${formatMoney(unpaidAmount)}</span><br>
      <strong>ของ:</strong> ${item.item}<br>
      <strong>ครบกำหนดรอบถัดไป:</strong> ${formatDate(due)}
    `;
    
    document.getElementById('payAmount').value = unpaidAmount > 0 ? unpaidAmount : interestPerPeriod;
  }

  document.getElementById('payNote').value = '';
  document.getElementById('payInterestModal').showModal();
}

document.getElementById('closePayInterestModal').addEventListener('click', () => document.getElementById('payInterestModal').close());
document.getElementById('cancelPayInterest').addEventListener('click', () => document.getElementById('payInterestModal').close());

document.getElementById('confirmPayInterest').addEventListener('click', () => {
  if (!_payContext) return;
  const amount = parseFloat(document.getElementById('payAmount').value);
  if (!amount || amount <= 0) { showToast('กรุณากรอกจำนวนดอก', 'error'); return; }

  const { type, id, item } = _payContext;

  const collection = type === 'loan' ? 'loans' : 'pawns';
  const records = DB.get(collection);
  const idx = records.findIndex(r => r.id === id);
  
  if (idx >= 0) {
    const rate = records[idx].rate || (type === 'loan' ? LOAN_RATE : PAWN_RATE);
    const legacyPaid = (records[idx].paidPeriods || 0) * (records[idx].amount * rate);
    const currentPaid = records[idx].paidInterest !== undefined ? records[idx].paidInterest : legacyPaid;
    
    records[idx].paidInterest = currentPaid + amount;
    
    if (type === 'loan') {
      records[idx].status = getContractStatus({ ...records[idx], _loanDefault: true });
    } else {
      records[idx].status = getContractStatus(records[idx]);
    }
    
    DB.set(collection, records);
  }

  // Log transaction
  const txs = DB.get('transactions');
  const cust = DB.get('customers').find(c => c.id === item.customerId);
  txs.push({
    id: genId(),
    date: today(),
    type: 'interest',
    customerId: item.customerId,
    amount,
    note: document.getElementById('payNote').value ||
      `รับดอก${type === 'loan' ? 'เงินกู้' : 'จำนำ'} ${formatMoney(amount)} – ${cust?.name || ''}`,
    subType: type,
    refId: id,
    createdAt: Date.now(),
  });
  DB.set('transactions', txs);

  document.getElementById('payInterestModal').close();
  showToast(`รับดอกเบี้ย ${formatMoney(amount)} แล้ว`, 'success');

  if (type === 'loan') renderLoans();
  else renderPawns();
  renderDashboard();
  updateBadges();
  _payContext = null;
});

// ============================================================
// Transactions
// ============================================================
function renderTransactions(filter = '', typeFilter = '') {
  let txs = DB.get('transactions').sort((a, b) => b.createdAt - a.createdAt);
  const customers = DB.get('customers');

  if (filter) {
    const q = filter.toLowerCase();
    txs = txs.filter(t => {
      const c = customers.find(c => c.id === t.customerId);
      return (c?.name || '').toLowerCase().includes(q) || (t.note || '').toLowerCase().includes(q);
    });
  }
  if (typeFilter) txs = txs.filter(t => t.type === typeFilter);

  const tbody = document.getElementById('txTableBody');
  if (txs.length === 0) {
    tbody.innerHTML = '<tr class="empty-row"><td colspan="7">ยังไม่มีรายการ</td></tr>';
    return;
  }

  const typeLabels = { interest: 'รับดอกเบี้ย', daily_payment: 'รับกู้รายวัน', loan_payment: 'รับคืนเงินกู้', pawn_redeem: 'ไถ่จำนำ', expense: 'รายจ่าย' };
  const typeBadges = { interest: 'badge-interest', daily_payment: 'badge-loan', loan_payment: 'badge-loan', pawn_redeem: 'badge-pawn', expense: 'badge-expense' };

  tbody.innerHTML = txs.map((t, i) => {
    const cust = customers.find(c => c.id === t.customerId);
    const isIncome = t.type !== 'expense';
    return `
      <tr>
        <td>${i + 1}</td>
        <td>${formatDate(t.date)}</td>
        <td><span class="type-badge ${typeBadges[t.type] || ''}">${typeLabels[t.type] || t.type}</span></td>
        <td>${cust?.name || '-'}</td>
        <td style="color:var(--text-secondary);font-size:0.8rem">${t.note || '-'}</td>
        <td style="color:${isIncome ? 'var(--accent-emerald)' : 'var(--accent-rose)'};font-weight:600">
          ${isIncome ? '+' : '-'}${formatMoney(t.amount)}
        </td>
        <td>
          <button class="btn-icon delete" title="ลบ" onclick="deleteTransaction('${t.id}')">🗑️</button>
        </td>
      </tr>`;
  }).join('');
}

document.getElementById('txSearch').addEventListener('input', (e) => {
  renderTransactions(e.target.value, document.getElementById('txTypeFilter').value);
});
document.getElementById('txTypeFilter').addEventListener('change', (e) => {
  renderTransactions(document.getElementById('txSearch').value, e.target.value);
});
document.getElementById('addTransactionBtn').addEventListener('click', () => openTxModal());

function openTxModal() {
  populateCustomerDropdowns();
  document.getElementById('txDate').value = today();
  document.getElementById('txType').value = '';
  document.getElementById('txAmount').value = '';
  document.getElementById('txNote').value = '';
  document.getElementById('transactionModal').showModal();
}

document.getElementById('closeTxModal').addEventListener('click', () => document.getElementById('transactionModal').close());
document.getElementById('cancelTx').addEventListener('click', () => document.getElementById('transactionModal').close());

document.getElementById('txForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const amount = parseFloat(document.getElementById('txAmount').value);
  const type = document.getElementById('txType').value;
  if (!type) { showToast('กรุณาเลือกประเภท', 'error'); return; }
  if (!amount || amount <= 0) { showToast('กรุณากรอกจำนวนเงิน', 'error'); return; }

  const txs = DB.get('transactions');
  txs.push({
    id: genId(),
    date: document.getElementById('txDate').value,
    type,
    customerId: document.getElementById('txCustomer').value,
    amount,
    note: document.getElementById('txNote').value,
    createdAt: Date.now(),
  });
  DB.set('transactions', txs);

  document.getElementById('transactionModal').close();
  renderTransactions();
  renderDashboard();
  showToast('บันทึกรายการแล้ว');
});

function deleteTransaction(id) {
  openConfirm('ต้องการลบรายการและดึงข้อมูลกลับใช่ไหม?', () => {
    const txs = DB.get('transactions');
    const tx = txs.find(t => t.id === id);
    if (!tx) return;

    if (tx.refId) {
      if (tx.type === 'interest') {
        const key = tx.subType === 'loan' ? 'loans' : 'pawns';
        const items = DB.get(key);
        const idx = items.findIndex(item => item.id === tx.refId);
        if (idx >= 0) {
          if (key === 'loans') {
            const legacyPaid = (items[idx].paidPeriods || 0) * (items[idx].amount * (items[idx].rate || LOAN_RATE));
            const currentPaid = items[idx].paidInterest !== undefined ? items[idx].paidInterest : legacyPaid;
            items[idx].paidInterest = Math.max(0, currentPaid - tx.amount);
            items[idx].status = getContractStatus({ ...items[idx], _loanDefault: true });
          } else {
            const legacyPaid = (items[idx].paidPeriods || 0) * (items[idx].amount * (items[idx].rate || PAWN_RATE));
            const currentPaid = items[idx].paidInterest !== undefined ? items[idx].paidInterest : legacyPaid;
            items[idx].paidInterest = Math.max(0, currentPaid - tx.amount);
            items[idx].status = getContractStatus(items[idx]);
          }
          DB.set(key, items);
        }
      } else if (tx.type === 'loan_payment') {
        const loans = DB.get('loans');
        const idx = loans.findIndex(l => l.id === tx.refId);
        if (idx >= 0) {
          loans[idx].status = 'active';
          DB.set('loans', loans);
        }
      } else if (tx.type === 'pawn_redeem') {
        const pawns = DB.get('pawns');
        const idx = pawns.findIndex(p => p.id === tx.refId);
        if (idx >= 0) {
          pawns[idx].status = 'active';
          DB.set('pawns', pawns);
        }
      } else if (tx.type === 'daily_payment') {
        const daily = DB.get('daily_loans');
        const idx = daily.findIndex(d => d.id === tx.refId);
        if (idx >= 0) {
          daily[idx].paidAmount = Math.max(0, (daily[idx].paidAmount || 0) - tx.amount);
          if (daily[idx].paidAmount < daily[idx].totalAmount) {
             daily[idx].status = 'active';
          }
          DB.set('daily_loans', daily);
        }
      }
    }

    DB.set('transactions', txs.filter(t => t.id !== id));
    renderTransactions();
    renderDashboard();
    updateBadges();
    showToast('ลบและคืนค่าข้อมูลแล้ว');
  });
}

// ============================================================
// Reports & Financial Analysis + Export (Excel / PDF)
// ============================================================
const THAI_MONTHS_FULL = [
  'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'
];

let _reportInitialized = false;

function initReportPage() {
  if (!_reportInitialized) {
    const now = new Date();
    const mEl = document.getElementById('reportMonth');
    const yEl = document.getElementById('reportYear');
    if (mEl) mEl.value = now.getMonth();
    if (yEl) yEl.value = now.getFullYear() + 543;
    _reportInitialized = true;
  }
  renderReportPage();
}

function filterByMonthYear(items, month, year) {
  return (items || []).filter(item => {
    if (!item.date) return false;
    const parts = item.date.split('-');
    if (parts.length === 3) {
      const iYear = parseInt(parts[0], 10);
      const iMonth = parseInt(parts[1], 10) - 1;
      return iMonth === month && iYear === year;
    }
    return false;
  });
}

function computeMonthlyReportData(month, thYear) {
  const year = thYear - 543;
  const monthName = THAI_MONTHS_FULL[month] || '';
  const allTxs = DB.get('transactions');
  const customers = DB.get('customers');
  const allLoans = DB.get('loans');
  const allDaily = DB.get('daily_loans');
  const allPawns = DB.get('pawns');

  const txs = filterByMonthYear(allTxs, month, year).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

  // Previous month for MoM comparison
  const prevMonth = month === 0 ? 11 : month - 1;
  const prevYear = month === 0 ? year - 1 : year;
  const prevThYear = prevYear + 543;
  const prevMonthName = THAI_MONTHS_FULL[prevMonth] || '';
  const prevTxs = filterByMonthYear(allTxs, prevMonth, prevYear);

  const calcTxMetrics = (txList) => {
    const income = txList.filter(t => t.type !== 'expense').reduce((s, t) => s + (Number(t.amount) || 0), 0);
    const expense = txList.filter(t => t.type === 'expense').reduce((s, t) => s + (Number(t.amount) || 0), 0);
    const loanInterest = txList.filter(t => t.type === 'interest' && t.subType === 'loan').reduce((s, t) => s + (Number(t.amount) || 0), 0);
    const pawnInterest = txList.filter(t => t.type === 'interest' && t.subType === 'pawn').reduce((s, t) => s + (Number(t.amount) || 0), 0);
    const manualInterest = txList.filter(t => t.type === 'interest' && !t.subType).reduce((s, t) => s + (Number(t.amount) || 0), 0);
    const dailyInterest = txList.filter(t => t.type === 'daily_payment').reduce((s, t) => s + (Number(t.interestAmount) || 0), 0);
    const dailyTotalPaid = txList.filter(t => t.type === 'daily_payment').reduce((s, t) => s + (Number(t.amount) || 0), 0);
    const dailyPrincipalReturned = Math.max(0, dailyTotalPaid - dailyInterest);
    const loanPrincipalReturned = txList.filter(t => t.type === 'loan_payment').reduce((s, t) => s + (Number(t.amount) || 0), 0);
    const pawnPrincipalRedeemed = txList.filter(t => t.type === 'pawn_redeem').reduce((s, t) => s + (Number(t.amount) || 0), 0);

    const totalInterestIncome = loanInterest + pawnInterest + manualInterest + dailyInterest;
    const totalPrincipalReturned = loanPrincipalReturned + pawnPrincipalRedeemed + dailyPrincipalReturned;
    const netProfit = totalInterestIncome - expense;

    return {
      income,
      expense,
      loanInterest,
      pawnInterest,
      manualInterest,
      dailyInterest,
      dailyTotalPaid,
      dailyPrincipalReturned,
      loanPrincipalReturned,
      pawnPrincipalRedeemed,
      totalInterestIncome,
      totalPrincipalReturned,
      netProfit,
    };
  };

  const curr = calcTxMetrics(txs);
  const prev = calcTxMetrics(prevTxs);

  // MoM Growth
  const profitDiff = curr.netProfit - prev.netProfit;
  const profitGrowthPct = prev.netProfit !== 0
    ? ((curr.netProfit - prev.netProfit) / Math.abs(prev.netProfit)) * 100
    : (curr.netProfit > 0 ? 100 : 0);

  const incomeDiff = curr.income - prev.income;
  const incomeGrowthPct = prev.income > 0
    ? ((curr.income - prev.income) / prev.income) * 100
    : (curr.income > 0 ? 100 : 0);

  // Profitability & Efficiency Ratios
  const netProfitMarginPct = curr.totalInterestIncome > 0
    ? (curr.netProfit / curr.totalInterestIncome) * 100
    : 0;
  const expenseToInterestRatioPct = curr.totalInterestIncome > 0
    ? (curr.expense / curr.totalInterestIncome) * 100
    : (curr.expense > 0 ? 100 : 0);

  // Product Share of Interest Revenue
  const intBase = curr.totalInterestIncome || 1;
  const loanInterestSharePct = curr.totalInterestIncome > 0 ? ((curr.loanInterest + curr.manualInterest) / intBase) * 100 : 0;
  const dailyInterestSharePct = curr.totalInterestIncome > 0 ? (curr.dailyInterest / intBase) * 100 : 0;
  const pawnInterestSharePct = curr.totalInterestIncome > 0 ? (curr.pawnInterest / intBase) * 100 : 0;

  const productRevenues = [
    { name: 'เงินกู้ดอกสะสมรายวัน', amount: curr.loanInterest + curr.manualInterest, share: loanInterestSharePct },
    { name: 'เงินกู้รายวัน', amount: curr.dailyInterest, share: dailyInterestSharePct },
    { name: 'จำนำ', amount: curr.pawnInterest, share: pawnInterestSharePct },
  ].sort((a, b) => b.amount - a.amount);

  const topProduct = curr.totalInterestIncome > 0 ? productRevenues[0].name : 'ยังไม่มีรายได้ดอกเบี้ย';

  // New contracts disbursed in this month (Cash Outflow for Lending)
  const newLoansInMonth = filterByMonthYear(allLoans, month, year);
  const newDailyInMonth = filterByMonthYear(allDaily, month, year);
  const newPawnsInMonth = filterByMonthYear(allPawns, month, year);

  const newLoansAmount = newLoansInMonth.reduce((s, l) => s + (Number(l.amount) || 0), 0);
  const newDailyAmount = newDailyInMonth.reduce((s, d) => s + (Number(d.amount) || 0), 0);
  const newPawnsAmount = newPawnsInMonth.reduce((s, p) => s + (Number(p.amount) || 0), 0);
  const totalNewDisbursed = newLoansAmount + newDailyAmount + newPawnsAmount;
  const totalNewContractsCount = newLoansInMonth.length + newDailyInMonth.length + newPawnsInMonth.length;

  const totalCashOutflow = totalNewDisbursed + curr.expense;
  const netCashFlow = curr.income - totalCashOutflow;

  // Portfolio Risk & Health Snapshot (Active Contracts)
  const activeLoans = allLoans.filter(l => l.status !== 'paid');
  const activePawns = allPawns.filter(p => !['redeemed', 'forfeited'].includes(p.status));
  const activeDaily = allDaily.filter(d => d.status !== 'paid');

  const overdueLoans = activeLoans.filter(l => getContractStatus({ ...l, _loanDefault: true }) === 'overdue');
  const overduePawns = activePawns.filter(p => getContractStatus(p) === 'overdue');
  const overdueDaily = activeDaily.filter(d => {
    const elapsedDays = daysBetween(d.date, today());
    const expectedPaid = Math.min(d.totalAmount, elapsedDays * d.dailyInstallment);
    return (d.paidAmount || 0) < expectedPaid;
  });

  const activeLoansPrincipal = activeLoans.reduce((s, l) => s + (Number(l.amount) || 0), 0);
  const activePawnsPrincipal = activePawns.reduce((s, p) => s + (Number(p.amount) || 0), 0);
  const activeDailyPrincipal = activeDaily.reduce((s, d) => s + (Number(d.amount) || 0), 0);
  const totalActivePrincipal = activeLoansPrincipal + activePawnsPrincipal + activeDailyPrincipal;

  const unpaidLoanInterest = activeLoans.reduce((s, l) => s + calcUnpaidInterest({ ...l, _loanDefault: true }), 0);
  const unpaidPawnInterest = activePawns.reduce((s, p) => s + calcUnpaidInterest(p), 0);
  const unpaidDailyInterest = activeDaily.reduce((s, d) => {
    const totalInt = (d.amount || 0) * (d.rate || 0);
    const paidInt = d.totalAmount ? ((d.paidAmount || 0) * (totalInt / d.totalAmount)) : 0;
    return s + Math.max(0, totalInt - paidInt);
  }, 0);
  const totalUnpaidInterest = unpaidLoanInterest + unpaidPawnInterest + unpaidDailyInterest;

  const totalActiveContracts = activeLoans.length + activePawns.length + activeDaily.length;
  const totalOverdueContracts = overdueLoans.length + overduePawns.length + overdueDaily.length;
  const overdueRatePct = totalActiveContracts > 0 ? (totalOverdueContracts / totalActiveContracts) * 100 : 0;
  const portfolioYieldRatePct = totalActivePrincipal > 0 ? (curr.totalInterestIncome / totalActivePrincipal) * 100 : 0;

  // Top Customers in Month by Profit / Interest Contributed
  const custContributionMap = new Map();
  txs.forEach(t => {
    if (t.type === 'expense' || !t.customerId) return;
    const cust = customers.find(c => c.id === t.customerId);
    const name = cust ? cust.name : 'ไม่ระบุชื่อ';
    const current = custContributionMap.get(t.customerId) || { name, totalPaid: 0, interestPaid: 0, txCount: 0 };
    current.totalPaid += Number(t.amount) || 0;
    if (t.type === 'interest') current.interestPaid += Number(t.amount) || 0;
    else if (t.type === 'daily_payment') current.interestPaid += Number(t.interestAmount) || 0;
    current.txCount += 1;
    custContributionMap.set(t.customerId, current);
  });

  const topCustomers = Array.from(custContributionMap.values())
    .sort((a, b) => b.interestPaid - a.interestPaid || b.totalPaid - a.totalPaid)
    .slice(0, 3);

  // Smart Financial Insights & Recommendations
  const insights = [];
  if (curr.totalInterestIncome > 0) {
    insights.push(
      `ผลิตภัณฑ์ที่สร้างรายได้ดอกเบี้ยสูงสุดในเดือน${monthName} คือ "${topProduct}" คิดเป็น ${productRevenues[0].share.toFixed(1)}% ของรายได้ดอกเบี้ยรวม (${formatMoney(productRevenues[0].amount)})`
    );
  } else {
    insights.push(`ยังไม่มีรายการรับชำระดอกเบี้ยในเดือน${monthName} ${thYear} แนะนำให้ตรวจสอบกำหนดชำระของสัญญาที่กำลังดำเนินการ`);
  }

  if (prev.netProfit !== 0 || prev.income !== 0) {
    const dirText = profitDiff >= 0 ? 'เพิ่มขึ้น' : 'ลดลง';
    insights.push(
      `เปรียบเทียบกับเดือน${prevMonthName} ${prevThYear}: กำไรสุทธิ${dirText} ${formatMoney(Math.abs(profitDiff))} (${profitGrowthPct >= 0 ? '+' : ''}${profitGrowthPct.toFixed(1)}%) และรายรับรวม${incomeDiff >= 0 ? 'เพิ่มขึ้น' : 'ลดลง'} ${formatMoney(Math.abs(incomeDiff))}`
    );
  }

  if (curr.expense > 0) {
    if (expenseToInterestRatioPct > 35) {
      insights.push(
        `ข้อควรระวังด้านต้นทุน: อัตราส่วนรายจ่ายต่อรายได้ดอกเบี้ยอยู่ที่ ${expenseToInterestRatioPct.toFixed(1)}% ซึ่งค่อนข้างสูง ควรควบคุมรายจ่ายดำเนินงานเพื่อรักษากำไรสุทธิ`
      );
    } else {
      insights.push(
        `การควบคุมค่าใช้จ่ายอยู่ในเกณฑ์ดี: รายจ่ายคิดเป็น ${expenseToInterestRatioPct.toFixed(1)}% ของรายได้ดอกเบี้ย ทำให้อัตรากำไรสุทธิ (Net Profit Margin) สูงถึง ${netProfitMarginPct.toFixed(1)}%`
      );
    }
  } else if (curr.totalInterestIncome > 0) {
    insights.push(`ประสิทธิภาพการทำกำไรสูงสุด: ไม่มีรายจ่ายดำเนินงานในเดือนนี้ ทำให้อัตรากำไรสุทธิอยู่ที่ 100% ของรายได้ดอกเบี้ย`);
  }

  if (totalOverdueContracts > 0) {
    insights.push(
      `ความเสี่ยงพอร์ตสินเชื่อ: ปัจจุบันมีสัญญาค้างชำระรวม ${totalOverdueContracts} สัญญา (${overdueRatePct.toFixed(1)}% ของสัญญาที่เปิดอยู่) และมีดอกเบี้ยค้างรับสะสม ${formatMoney(totalUnpaidInterest)} ควรเร่งติดตามเก็บดอกเบี้ยค้างรับเพื่อเสริมสภาพคล่อง`
    );
  } else if (totalActiveContracts > 0) {
    insights.push(
      `คุณภาพพอร์ตสินเชื่อดีเยี่ยม: สัญญาที่กำลังดำเนินการทั้งหมด ${totalActiveContracts} สัญญา (เงินต้นรวม ${formatMoney(totalActivePrincipal)}) ไม่มีรายการค้างชำระเกินกำหนด`
    );
  }

  if (totalNewDisbursed > 0) {
    insights.push(
      `กระแสเงินสดและการขยายพอร์ต: เดือนนี้มีการปล่อยกู้/รับจำนำใหม่ ${totalNewContractsCount} สัญญา เป็นเงินต้นรวม ${formatMoney(totalNewDisbursed)} ส่งผลให้กระแสเงินสดสุทธิประจำเดือนอยู่ที่ ${netCashFlow >= 0 ? '+' : '-'}${formatMoney(Math.abs(netCashFlow))}`
    );
  }

  return {
    month,
    thYear,
    year,
    monthName,
    txs,
    customers,
    ...curr,
    analysis: {
      prevMonthName,
      prevThYear,
      prevIncome: prev.income,
      prevNetProfit: prev.netProfit,
      prevExpense: prev.expense,
      profitDiff,
      profitGrowthPct,
      incomeDiff,
      incomeGrowthPct,
      netProfitMarginPct,
      expenseToInterestRatioPct,
      loanInterestSharePct,
      dailyInterestSharePct,
      pawnInterestSharePct,
      topProduct,
      productRevenues,
      newLoansCount: newLoansInMonth.length,
      newDailyCount: newDailyInMonth.length,
      newPawnsCount: newPawnsInMonth.length,
      totalNewContractsCount,
      newLoansAmount,
      newDailyAmount,
      newPawnsAmount,
      totalNewDisbursed,
      totalCashOutflow,
      netCashFlow,
      activeLoansCount: activeLoans.length,
      activePawnsCount: activePawns.length,
      activeDailyCount: activeDaily.length,
      totalActiveContracts,
      totalOverdueContracts,
      overdueRatePct,
      activeLoansPrincipal,
      activePawnsPrincipal,
      activeDailyPrincipal,
      totalActivePrincipal,
      unpaidLoanInterest,
      unpaidPawnInterest,
      unpaidDailyInterest,
      totalUnpaidInterest,
      portfolioYieldRatePct,
      topCustomers,
      insights,
    }
  };
}

function renderReportPage() {
  const monthEl = document.getElementById('reportMonth');
  const yearEl = document.getElementById('reportYear');
  if (!monthEl || !yearEl) return;

  const month = parseInt(monthEl.value, 10);
  const thYear = parseInt(yearEl.value, 10);
  const report = computeMonthlyReportData(month, thYear);
  const { analysis } = report;

  // Update KPI Cards
  document.getElementById('report-income').textContent = formatMoney(report.income);
  const expenseEl = document.getElementById('report-expense');
  if (expenseEl) expenseEl.textContent = formatMoney(report.expense);
  document.getElementById('report-profit').textContent = formatMoney(report.netProfit);
  document.getElementById('report-loan-interest').textContent = formatMoney(report.loanInterest + report.manualInterest);

  const dailyInterestEl = document.getElementById('report-daily-interest');
  if (dailyInterestEl) dailyInterestEl.textContent = formatMoney(report.dailyInterest);

  document.getElementById('report-pawn-interest').textContent = formatMoney(report.pawnInterest);

  // Toggle & Render Financial Analysis Section
  const includeAnalysis = document.getElementById('includeFinancialAnalysis')?.checked;
  const analysisSection = document.getElementById('financialAnalysisSection');
  const analysisBadge = document.getElementById('analysisPeriodBadge');
  const analysisContent = document.getElementById('financialAnalysisContent');

  if (analysisBadge) {
    analysisBadge.textContent = `${report.monthName} ${report.thYear}`;
  }

  if (analysisSection) {
    analysisSection.style.display = includeAnalysis ? 'block' : 'none';
  }

  if (analysisContent && includeAnalysis) {
    const momColor = analysis.profitDiff >= 0 ? 'var(--accent-emerald)' : 'var(--accent-rose)';
    const momSign = analysis.profitDiff >= 0 ? '+' : '-';
    const cfColor = analysis.netCashFlow >= 0 ? 'var(--accent-emerald)' : 'var(--accent-rose)';
    const cfSign = analysis.netCashFlow >= 0 ? '+' : '-';

    analysisContent.innerHTML = `
      <div class="analysis-grid">
        <div class="analysis-box">
          <div class="analysis-box-title">📊 ประสิทธิภาพการทำกำไร & เทียบเดือนก่อน</div>
          <div class="analysis-stat-row">
            <span class="analysis-stat-label">รายได้ดอกเบี้ยรวม:</span>
            <span class="analysis-stat-val" style="color:var(--accent-gold)">${formatMoney(report.totalInterestIncome)}</span>
          </div>
          <div class="analysis-stat-row">
            <span class="analysis-stat-label">เงินต้นที่ได้รับคืน:</span>
            <span class="analysis-stat-val">${formatMoney(report.totalPrincipalReturned)}</span>
          </div>
          <div class="analysis-stat-row">
            <span class="analysis-stat-label">อัตรากำไรสุทธิ (Net Margin):</span>
            <span class="analysis-stat-val" style="color:var(--accent-emerald)">${analysis.netProfitMarginPct.toFixed(1)}%</span>
          </div>
          <div class="analysis-stat-row">
            <span class="analysis-stat-label">สัดส่วนรายจ่ายต่อดอกเบี้ย:</span>
            <span class="analysis-stat-val">${analysis.expenseToInterestRatioPct.toFixed(1)}%</span>
          </div>
          <div class="analysis-stat-row">
            <span class="analysis-stat-label">เทียบเดือน${analysis.prevMonthName}:</span>
            <span class="analysis-stat-val" style="color:${momColor}">
              ${momSign}${formatMoney(Math.abs(analysis.profitDiff))} (${analysis.profitGrowthPct >= 0 ? '+' : ''}${analysis.profitGrowthPct.toFixed(1)}%)
            </span>
          </div>
        </div>

        <div class="analysis-box">
          <div class="analysis-box-title">🥧 โครงสร้างรายได้ดอกเบี้ยตามผลิตภัณฑ์</div>
          <div class="analysis-stat-row">
            <span class="analysis-stat-label">กู้ดอกสะสมรายวัน:</span>
            <span class="analysis-stat-val">${formatMoney(report.loanInterest + report.manualInterest)} (${analysis.loanInterestSharePct.toFixed(1)}%)</span>
          </div>
          <div class="analysis-stat-row">
            <span class="analysis-stat-label">กู้รายวัน:</span>
            <span class="analysis-stat-val">${formatMoney(report.dailyInterest)} (${analysis.dailyInterestSharePct.toFixed(1)}%)</span>
          </div>
          <div class="analysis-stat-row">
            <span class="analysis-stat-label">จำนำ:</span>
            <span class="analysis-stat-val">${formatMoney(report.pawnInterest)} (${analysis.pawnInterestSharePct.toFixed(1)}%)</span>
          </div>
          <div class="analysis-stat-row">
            <span class="analysis-stat-label">พอร์ตทำกำไรสูงสุด:</span>
            <span class="analysis-stat-val" style="color:var(--accent-gold)">${analysis.topProduct}</span>
          </div>
          <div class="analysis-stat-row">
            <span class="analysis-stat-label">ผลตอบแทนต่อพอร์ต (Yield):</span>
            <span class="analysis-stat-val">${analysis.portfolioYieldRatePct.toFixed(1)}% / เดือน</span>
          </div>
        </div>

        <div class="analysis-box">
          <div class="analysis-box-title">💸 การวิเคราะห์กระแสเงินสด (Cash Flow)</div>
          <div class="analysis-stat-row">
            <span class="analysis-stat-label">กระแสเงินสดรับเข้า (Inflow):</span>
            <span class="analysis-stat-val" style="color:var(--accent-emerald)">+${formatMoney(report.income)}</span>
          </div>
          <div class="analysis-stat-row">
            <span class="analysis-stat-label">ปล่อยกู้/รับจำนำใหม่ (${analysis.totalNewContractsCount} สัญญา):</span>
            <span class="analysis-stat-val" style="color:var(--accent-rose)">-${formatMoney(analysis.totalNewDisbursed)}</span>
          </div>
          <div class="analysis-stat-row">
            <span class="analysis-stat-label">รายจ่ายดำเนินงาน:</span>
            <span class="analysis-stat-val" style="color:var(--accent-rose)">-${formatMoney(report.expense)}</span>
          </div>
          <div class="analysis-stat-row">
            <span class="analysis-stat-label">กระแสเงินสดสุทธิประจำเดือน:</span>
            <span class="analysis-stat-val" style="color:${cfColor}">${cfSign}${formatMoney(Math.abs(analysis.netCashFlow))}</span>
          </div>
        </div>

        <div class="analysis-box">
          <div class="analysis-box-title">🛡️ คุณภาพพอร์ต & ความเสี่ยงหนี้ค้างชำระ</div>
          <div class="analysis-stat-row">
            <span class="analysis-stat-label">เงินต้นคงค้างในระบบรวม:</span>
            <span class="analysis-stat-val">${formatMoney(analysis.totalActivePrincipal)} (${analysis.totalActiveContracts} สัญญา)</span>
          </div>
          <div class="analysis-stat-row">
            <span class="analysis-stat-label">ดอกเบี้ยค้างรับสะสมรวม:</span>
            <span class="analysis-stat-val" style="color:var(--accent-gold)">${formatMoney(analysis.totalUnpaidInterest)}</span>
          </div>
          <div class="analysis-stat-row">
            <span class="analysis-stat-label">สัญญาที่เกินกำหนดชำระ:</span>
            <span class="analysis-stat-val" style="color:${analysis.totalOverdueContracts > 0 ? 'var(--accent-rose)' : 'var(--accent-emerald)'}">
              ${analysis.totalOverdueContracts} สัญญา (${analysis.overdueRatePct.toFixed(1)}%)
            </span>
          </div>
          <div class="analysis-stat-row">
            <span class="analysis-stat-label">ลูกค้าที่สร้างรายได้สูงสุด:</span>
            <span class="analysis-stat-val">
              ${analysis.topCustomers.length > 0 ? `${analysis.topCustomers[0].name} (${formatMoney(analysis.topCustomers[0].interestPaid || analysis.topCustomers[0].totalPaid)})` : '-'}
            </span>
          </div>
        </div>
      </div>

      <div class="analysis-insights">
        <div class="analysis-insights-title">💡 สรุปผลการวิเคราะห์และข้อเสนอแนะเชิงกลยุทธ์ (Executive Summary)</div>
        <ul class="analysis-insight-list">
          ${analysis.insights.map(item => `<li><span>•</span><span>${item}</span></li>`).join('')}
        </ul>
      </div>
    `;
  }

  // Render Transactions Table
  const typeLabels = {
    interest: 'รับดอกเบี้ย',
    daily_payment: 'รับกู้รายวัน',
    loan_payment: 'รับคืนเงินกู้',
    pawn_redeem: 'ไถ่จำนำ',
    expense: 'รายจ่าย'
  };
  const typeBadges = {
    interest: 'badge-interest',
    daily_payment: 'badge-loan',
    loan_payment: 'badge-loan',
    pawn_redeem: 'badge-pawn',
    expense: 'badge-expense'
  };

  const countBadge = document.getElementById('reportTxCount');
  if (countBadge) countBadge.textContent = `${report.txs.length} รายการ`;

  const tbody = document.getElementById('reportTxBody');
  if (report.txs.length === 0) {
    tbody.innerHTML = '<tr class="empty-row"><td colspan="5">ไม่มีรายการในช่วงนี้</td></tr>';
    return;
  }

  tbody.innerHTML = report.txs.map(t => {
    const cust = report.customers.find(c => c.id === t.customerId);
    const isIncome = t.type !== 'expense';
    return `
      <tr>
        <td>${formatDate(t.date)}</td>
        <td><span class="type-badge ${typeBadges[t.type] || ''}">${typeLabels[t.type] || t.type}</span></td>
        <td>${cust?.name || '-'}</td>
        <td style="color:var(--text-secondary);font-size:0.8rem">${t.note || '-'}</td>
        <td style="color:${isIncome ? 'var(--accent-emerald)' : 'var(--accent-rose)'};font-weight:600">
          ${isIncome ? '+' : '-'}${formatMoney(t.amount)}
        </td>
      </tr>`;
  }).join('');

  if (typeof window.updateTableLabels === 'function') {
    window.updateTableLabels();
  }
}

document.getElementById('generateReport')?.addEventListener('click', () => {
  renderReportPage();
  showToast('สร้างรายงานประจำเดือนเรียบร้อยแล้ว');
});

document.getElementById('reportMonth')?.addEventListener('change', renderReportPage);
document.getElementById('reportYear')?.addEventListener('change', renderReportPage);
document.getElementById('includeFinancialAnalysis')?.addEventListener('change', renderReportPage);

function triggerBlobDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.style.display = 'none';
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    a.remove();
    URL.revokeObjectURL(url);
  }, 2000);
}

// ============================================================
// Export Report to Excel (.xlsx with fallback to .xls)
// ============================================================
function exportReportToExcel() {
  try {
    const month = parseInt(document.getElementById('reportMonth').value, 10);
    const thYear = parseInt(document.getElementById('reportYear').value, 10);
    const includeAnalysis = Boolean(document.getElementById('includeFinancialAnalysis')?.checked);

    renderReportPage();

    const report = computeMonthlyReportData(month, thYear);
    const { analysis } = report;
    const managerName = sessionStorage.getItem('vider_manager') || 'ผู้จัดการระบบ';
    const exportDateStr = formatDate(today());
    const typeLabels = {
      interest: 'รับดอกเบี้ย',
      daily_payment: 'รับกู้รายวัน',
      loan_payment: 'รับคืนเงินกู้',
      pawn_redeem: 'ไถ่จำนำ',
      expense: 'รายจ่าย'
    };

    // Sheet 1: สรุปรายงานประจำเดือน
    const summaryRows = [
      ['รายงานการเงินประจำเดือน - Vider Finance'],
      [`ประจำเดือน: ${report.monthName} พ.ศ. ${report.thYear}`, '', `วันที่ออกรายงาน: ${exportDateStr}`, `ผู้ออกรายงาน: ${managerName}`],
      [],
      ['สรุปผลประกอบการหลักประจำเดือน (Monthly KPI Summary)'],
      ['หัวข้อรายการ', 'จำนวนเงิน (บาท)', 'สัดส่วน / หมายเหตุ'],
      ['รายรับรวมทั้งหมด (รวมเงินต้นรับคืน)', report.income, 'รายรับเงินสดเข้าทั้งหมดในเดือนนี้'],
      ['รายได้ดอกเบี้ยรวมทั้งหมด', report.totalInterestIncome, 'กำไรขั้นต้นจากดอกเบี้ยก่อนหักค่าใช้จ่าย'],
      ['  - ดอกเบี้ยรับ (กู้ดอกสะสมรายวัน)', report.loanInterest + report.manualInterest, `${analysis.loanInterestSharePct.toFixed(1)}% ของรายได้ดอกเบี้ย`],
      ['  - ดอกเบี้ยรับ (กู้รายวัน)', report.dailyInterest, `${analysis.dailyInterestSharePct.toFixed(1)}% ของรายได้ดอกเบี้ย`],
      ['  - ดอกเบี้ยรับ (จำนำ)', report.pawnInterest, `${analysis.pawnInterestSharePct.toFixed(1)}% ของรายได้ดอกเบี้ย`],
      ['เงินต้นที่ได้รับชำระคืนรวม', report.totalPrincipalReturned, 'คืนเงินกู้ + ไถ่จำนำ + เงินต้นรายวัน'],
      ['รายจ่ายดำเนินงานทั้งหมด', report.expense, `${analysis.expenseToInterestRatioPct.toFixed(1)}% ของรายได้ดอกเบี้ย`],
      ['กำไรสุทธิประจำเดือน (Net Profit)', report.netProfit, `อัตรากำไรสุทธิ ${analysis.netProfitMarginPct.toFixed(1)}%`],
    ];

    // Sheet 2 (Optional): วิเคราะห์การเงินเชิงลึก
    const analysisRows = [
      [`บทวิเคราะห์การเงินเชิงลึก (Financial Analysis) - เดือน${report.monthName} พ.ศ. ${report.thYear}`],
      [],
      ['หมวดหมู่การวิเคราะห์', 'ตัวชี้วัดทางการเงิน (Metric)', 'ค่าที่ได้ / ผลลัพธ์', 'คำอธิบายและการตีความ'],
      ['1. เปรียบเทียบเดือนก่อน (MoM)', `กำไรสุทธิเทียบเดือน${analysis.prevMonthName} ${analysis.prevThYear}`, analysis.profitDiff, `เปลี่ยนแปลง ${analysis.profitGrowthPct >= 0 ? '+' : ''}${analysis.profitGrowthPct.toFixed(1)}% (เดือนก่อน ${formatMoney(analysis.prevNetProfit)})`],
      ['1. เปรียบเทียบเดือนก่อน (MoM)', `รายรับรวมเทียบเดือน${analysis.prevMonthName} ${analysis.prevThYear}`, analysis.incomeDiff, `เปลี่ยนแปลง ${analysis.incomeGrowthPct >= 0 ? '+' : ''}${analysis.incomeGrowthPct.toFixed(1)}% (เดือนก่อน ${formatMoney(analysis.prevIncome)})`],
      ['2. ประสิทธิภาพการทำกำไร', 'อัตรากำไรสุทธิ (Net Profit Margin)', `${analysis.netProfitMarginPct.toFixed(2)}%`, 'กำไรสุทธิเทียบกับรายได้ดอกเบี้ยรวม'],
      ['2. ประสิทธิภาพการทำกำไร', 'อัตราส่วนค่าใช้จ่ายต่อรายได้ดอกเบี้ย', `${analysis.expenseToInterestRatioPct.toFixed(2)}%`, 'รายจ่ายดำเนินงานเทียบกับรายได้ดอกเบี้ยรวม'],
      ['2. ประสิทธิภาพการทำกำไร', 'ผลิตภัณฑ์ที่ทำกำไรสูงสุดประจำเดือน', analysis.topProduct, 'พิจารณาจากยอดดอกเบี้ยรับจริงในเดือน'],
      ['2. ประสิทธิภาพการทำกำไร', 'อัตราผลตอบแทนต่อพอร์ต (Monthly Portfolio Yield)', `${analysis.portfolioYieldRatePct.toFixed(2)}%`, 'รายได้ดอกเบี้ยเดือนนี้เทียบกับเงินต้นคงค้างรวม'],
      ['3. กระแสเงินสด (Cash Flow)', 'กระแสเงินสดรับเข้า (Cash Inflow)', report.income, 'รวมดอกเบี้ยรับและเงินต้นรับคืน'],
      ['3. กระแสเงินสด (Cash Flow)', 'ยอดปล่อยกู้/รับจำนำใหม่ในเดือน (Disbursement)', analysis.totalNewDisbursed, `รวม ${analysis.totalNewContractsCount} สัญญาใหม่ (กู้ ${analysis.newLoansCount}, รายวัน ${analysis.newDailyCount}, จำนำ ${analysis.newPawnsCount})`],
      ['3. กระแสเงินสด (Cash Flow)', 'กระแสเงินสดจ่ายออกรวม (Cash Outflow)', analysis.totalCashOutflow, 'ยอดปล่อยสินเชื่อใหม่ + รายจ่ายดำเนินงาน'],
      ['3. กระแสเงินสด (Cash Flow)', 'กระแสเงินสดสุทธิประจำเดือน (Net Cash Flow)', analysis.netCashFlow, analysis.netCashFlow >= 0 ? 'สภาพคล่องเป็นบวก (เงินสดสุทธิเพิ่มขึ้น)' : 'สภาพคล่องลดลงจากการปล่อยสินเชื่อขยายพอร์ต'],
      ['4. ความเสี่ยงและคุณภาพพอร์ต', 'เงินต้นคงค้างในระบบปัจจุบันรวม', analysis.totalActivePrincipal, `รวม ${analysis.totalActiveContracts} สัญญาที่กำลังดำเนินการ`],
      ['4. ความเสี่ยงและคุณภาพพอร์ต', '  - เงินต้นกู้ดอกสะสมรายวันคงค้าง', analysis.activeLoansPrincipal, `${analysis.activeLoansCount} สัญญา`],
      ['4. ความเสี่ยงและคุณภาพพอร์ต', '  - เงินต้นกู้รายวันคงค้าง', analysis.activeDailyPrincipal, `${analysis.activeDailyCount} สัญญา`],
      ['4. ความเสี่ยงและคุณภาพพอร์ต', '  - เงินต้นจำนำคงค้าง', analysis.activePawnsPrincipal, `${analysis.activePawnsCount} รายการ`],
      ['4. ความเสี่ยงและคุณภาพพอร์ต', 'ดอกเบี้ยค้างรับสะสมรวม (Unpaid Interest)', analysis.totalUnpaidInterest, `กู้สะสม ${formatMoney(analysis.unpaidLoanInterest)} | รายวัน ${formatMoney(analysis.unpaidDailyInterest)} | จำนำ ${formatMoney(analysis.unpaidPawnInterest)}`],
      ['4. ความเสี่ยงและคุณภาพพอร์ต', 'สัญญาที่เกินกำหนดชำระ (Overdue Contracts)', `${analysis.totalOverdueContracts} สัญญา`, `คิดเป็น ${analysis.overdueRatePct.toFixed(1)}% ของสัญญาที่เปิดอยู่ทั้งหมด`],
      [],
      ['5. ลูกค้าที่สร้างรายได้สูงสุดประจำเดือน (Top Customers)'],
      ['อันดับ', 'ชื่อลูกค้า', 'ดอกเบี้ยที่ชำระในเดือน (บาท)', 'ยอดชำระรวมทั้งหมด (บาท)']
    ];

    if (analysis.topCustomers.length === 0) {
      analysisRows.push(['-', 'ไม่มีข้อมูลลูกค้าในเดือนนี้', 0, 0]);
    } else {
      analysis.topCustomers.forEach((c, idx) => {
        analysisRows.push([idx + 1, c.name, Math.round(c.interestPaid * 100) / 100, Math.round(c.totalPaid * 100) / 100]);
      });
    }

    analysisRows.push([], ['6. สรุปผลการวิเคราะห์และข้อเสนอแนะเชิงกลยุทธ์ (Executive Summary)']);
    analysis.insights.forEach((insight, idx) => {
      analysisRows.push([`ข้อที่ ${idx + 1}`, insight]);
    });

    if (includeAnalysis) {
      summaryRows.push(
        [],
        ['สรุปไฮไลท์การวิเคราะห์การเงิน (ดูรายละเอียดฉบับเต็มได้ที่ชีต "วิเคราะห์การเงินเชิงลึก")'],
        ['อัตรากำไรสุทธิ (Net Margin)', `${analysis.netProfitMarginPct.toFixed(1)}%`, `เทียบเดือน${analysis.prevMonthName}: ${analysis.profitGrowthPct >= 0 ? '+' : ''}${analysis.profitGrowthPct.toFixed(1)}%`],
        ['กระแสเงินสดสุทธิ (Net Cash Flow)', analysis.netCashFlow, `ปล่อยสินเชื่อใหม่เดือนนี้ ${analysis.totalNewContractsCount} สัญญา (${formatMoney(analysis.totalNewDisbursed)})`],
        ['ความเสี่ยงหนี้ค้างชำระ (Overdue Rate)', `${analysis.overdueRatePct.toFixed(1)}%`, `ค้างชำระ ${analysis.totalOverdueContracts} สัญญา | ดอกค้างรับรวม ${formatMoney(analysis.totalUnpaidInterest)}`]
      );
    }

    // Sheet: รายการธุรกรรม
    const txRows = [
      [`รายการธุรกรรมประจำเดือน ${report.monthName} พ.ศ. ${report.thYear} (${report.txs.length} รายการ)`],
      [],
      ['ลำดับ', 'วันที่', 'ประเภทธุรกรรม', 'ชื่อลูกค้า', 'เบอร์โทรศัพท์', 'รายละเอียด / หมายเหตุ', 'รายรับ (บาท)', 'รายจ่าย (บาท)', 'ส่วนที่เป็นกำไรดอกเบี้ย (บาท)', 'จำนวนเงินสุทธิ (บาท)']
    ];

    report.txs.forEach((t, idx) => {
      const cust = report.customers.find(c => c.id === t.customerId);
      const isIncome = t.type !== 'expense';
      const amt = Number(t.amount) || 0;
      const profitPart = t.type === 'interest'
        ? amt
        : (t.type === 'daily_payment' ? (Number(t.interestAmount) || 0) : 0);

      txRows.push([
        idx + 1,
        formatDate(t.date),
        typeLabels[t.type] || t.type,
        cust?.name || '-',
        cust?.phone || '-',
        t.note || '-',
        isIncome ? amt : 0,
        isIncome ? 0 : amt,
        Math.round(profitPart * 100) / 100,
        isIncome ? amt : -amt
      ]);
    });

    txRows.push(
      [],
      [
        '',
        '',
        '',
        '',
        '',
        'รวมทั้งหมด (Total)',
        report.income,
        report.expense,
        Math.round(report.totalInterestIncome * 100) / 100,
        report.income - report.expense
      ]
    );

    const fileBaseName = `รายงานการเงิน_ViderFinance_${report.monthName}_${report.thYear}${includeAnalysis ? '_พร้อมวิเคราะห์การเงิน' : ''}`;

    if (typeof window.XLSX !== 'undefined') {
      const wb = window.XLSX.utils.book_new();

      const wsSummary = window.XLSX.utils.aoa_to_sheet(summaryRows);
      wsSummary['!cols'] = [{ wch: 38 }, { wch: 24 }, { wch: 48 }, { wch: 30 }];
      window.XLSX.utils.book_append_sheet(wb, wsSummary, 'สรุปรายงานประจำเดือน');

      if (includeAnalysis) {
        const wsAnalysis = window.XLSX.utils.aoa_to_sheet(analysisRows);
        wsAnalysis['!cols'] = [{ wch: 30 }, { wch: 42 }, { wch: 22 }, { wch: 52 }];
        window.XLSX.utils.book_append_sheet(wb, wsAnalysis, 'วิเคราะห์การเงินเชิงลึก');
      }

      const wsTx = window.XLSX.utils.aoa_to_sheet(txRows);
      wsTx['!cols'] = [
        { wch: 8 }, { wch: 14 }, { wch: 18 }, { wch: 24 }, { wch: 16 },
        { wch: 36 }, { wch: 16 }, { wch: 16 }, { wch: 24 }, { wch: 18 }
      ];
      window.XLSX.utils.book_append_sheet(wb, wsTx, 'รายการธุรกรรม');

      const wbBuffer = window.XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
      const blob = new Blob([wbBuffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      });
      triggerBlobDownload(blob, `${fileBaseName}.xlsx`);
      showToast(`ดาวน์โหลดไฟล์ Excel (${fileBaseName}.xlsx) สำเร็จ`);
      return;
    }

    // Offline Fallback: .xls HTML Workbook with UTF-8 BOM
    const escapeHtml = (val) => String(val ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const rowsToHtmlTable = (rows) => `
      <table border="1" cellspacing="0" cellpadding="6" style="border-collapse:collapse;font-family:'Noto Sans Thai',Tahoma,sans-serif;font-size:11pt;">
        ${rows.map((r, rIdx) => `
          <tr style="${rIdx === 0 ? 'background:#f59e0b;color:#000;font-weight:bold;font-size:13pt;' : ''}">
            ${r.map(cell => `<td style="border:1px solid #cbd5e1;padding:6px;">${escapeHtml(cell)}</td>`).join('')}
          </tr>
        `).join('')}
      </table>
    `;

    const xlsHtml = `
      <html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
      <head><meta charset="UTF-8"></head>
      <body>
        ${rowsToHtmlTable(summaryRows)}
        ${includeAnalysis ? `<br/><br/>${rowsToHtmlTable(analysisRows)}` : ''}
        <br/><br/>
        ${rowsToHtmlTable(txRows)}
      </body>
      </html>
    `;

    const blob = new Blob(['\uFEFF' + xlsHtml], { type: 'application/vnd.ms-excel;charset=utf-8;' });
    triggerBlobDownload(blob, `${fileBaseName}.xls`);
    showToast(`ดาวน์โหลดไฟล์ Excel (${fileBaseName}.xls) สำเร็จ`);
  } catch (err) {
    console.error('Excel Export Error:', err);
    showToast('เกิดข้อผิดพลาดในการส่งออก Excel: ' + err.message, 'error');
  }
}

// ============================================================
// Export Report to PDF (Multi-page A4 with Thai font support)
// ============================================================
function buildReportPdfBlocks(report, includeAnalysis) {
  const { analysis } = report;
  const managerName = sessionStorage.getItem('vider_manager') || 'ผู้จัดการระบบ';
  const exportDateStr = formatDate(today());
  const typeLabels = {
    interest: 'รับดอกเบี้ย',
    daily_payment: 'รับกู้รายวัน',
    loan_payment: 'รับคืนเงินกู้',
    pawn_redeem: 'ไถ่จำนำ',
    expense: 'รายจ่าย'
  };
  const escapeHtml = (val) => String(val ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const blocks = [];

  // Block 1: Document Header + KPI Summary
  blocks.push(`
    <div style="margin-bottom:18px;">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #0f172a;padding-bottom:14px;margin-bottom:18px;">
        <div style="display:flex;align-items:center;gap:12px;">
          <div style="width:40px;height:40px;border-radius:8px;background:#f59e0b;color:#0f172a;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:20px;">₿</div>
          <div>
            <div style="margin:0;font-size:22px;font-weight:700;color:#0f172a;line-height:1.2;">Vider Finance</div>
            <div style="font-size:12px;color:#475569;">ระบบบริหารจัดการสินเชื่อเงินกู้และจำนำครบวงจร</div>
          </div>
        </div>
        <div style="text-align:right;font-size:12px;color:#334155;">
          <div style="font-size:16px;font-weight:700;color:#0f172a;">รายงานการเงินประจำเดือน${escapeHtml(report.monthName)} พ.ศ. ${report.thYear}</div>
          <div>วันที่ออกรายงาน: ${exportDateStr}</div>
          <div>ผู้จัดการผู้ออกรายงาน: ${escapeHtml(managerName)}</div>
        </div>
      </div>

      <div style="font-size:15px;font-weight:700;color:#0f172a;border-left:4px solid #0f172a;padding-left:10px;margin-bottom:12px;">
        ส่วนที่ 1: สรุปผลประกอบการประจำเดือน (Executive KPI Summary)
      </div>
      <div style="display:grid;grid-template-columns:repeat(3, 1fr);gap:10px;">
        <div style="border:1px solid #cbd5e1;border-left:4px solid #f59e0b;border-radius:6px;padding:10px 12px;background:#fffbeb;">
          <div style="font-size:11.5px;color:#475569;">รายรับรวมทั้งหมด (รวมเงินต้นคืน)</div>
          <div style="font-size:18px;font-weight:700;color:#0f172a;">${formatMoney(report.income)}</div>
        </div>
        <div style="border:1px solid #cbd5e1;border-left:4px solid #10b981;border-radius:6px;padding:10px 12px;background:#ecfdf5;">
          <div style="font-size:11.5px;color:#475569;">กำไรสุทธิประจำเดือน (Net Profit)</div>
          <div style="font-size:18px;font-weight:700;color:#059669;">${formatMoney(report.netProfit)}</div>
        </div>
        <div style="border:1px solid #cbd5e1;border-left:4px solid #f43f5e;border-radius:6px;padding:10px 12px;background:#fff1f2;">
          <div style="font-size:11.5px;color:#475569;">รายจ่ายดำเนินงานทั้งหมด</div>
          <div style="font-size:18px;font-weight:700;color:#e11d48;">${formatMoney(report.expense)}</div>
        </div>
        <div style="border:1px solid #cbd5e1;border-radius:6px;padding:10px 12px;background:#f8fafc;">
          <div style="font-size:11.5px;color:#475569;">ดอกเบี้ยรับ (กู้ดอกสะสมรายวัน)</div>
          <div style="font-size:16px;font-weight:700;color:#0f172a;">${formatMoney(report.loanInterest + report.manualInterest)}</div>
        </div>
        <div style="border:1px solid #cbd5e1;border-radius:6px;padding:10px 12px;background:#f8fafc;">
          <div style="font-size:11.5px;color:#475569;">ดอกเบี้ยรับ (กู้รายวัน)</div>
          <div style="font-size:16px;font-weight:700;color:#0f172a;">${formatMoney(report.dailyInterest)}</div>
        </div>
        <div style="border:1px solid #cbd5e1;border-radius:6px;padding:10px 12px;background:#f8fafc;">
          <div style="font-size:11.5px;color:#475569;">ดอกเบี้ยรับ (จำนำ)</div>
          <div style="font-size:16px;font-weight:700;color:#0f172a;">${formatMoney(report.pawnInterest)}</div>
        </div>
      </div>
    </div>
  `);

  // Optional Blocks 2 & 3: Financial Analysis
  if (includeAnalysis) {
    blocks.push(`
      <div style="margin-bottom:14px;">
        <div style="font-size:15px;font-weight:700;color:#0f172a;border-left:4px solid #d97706;padding-left:10px;margin-bottom:12px;">
          ส่วนที่ 2: บทวิเคราะห์การเงินเชิงลึก (Financial Analysis)
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
          <div style="border:1px solid #cbd5e1;border-radius:8px;padding:12px;background:#f8fafc;">
            <div style="font-weight:700;color:#b45309;margin-bottom:6px;font-size:13px;">📊 ประสิทธิภาพการทำกำไร & เทียบเดือนก่อน</div>
            <table style="width:100%;font-size:12px;border-collapse:collapse;">
              <tr><td style="padding:3px 0;color:#475569;">รายได้ดอกเบี้ยรวม:</td><td style="text-align:right;font-weight:600;">${formatMoney(report.totalInterestIncome)}</td></tr>
              <tr><td style="padding:3px 0;color:#475569;">เงินต้นที่ได้รับคืน:</td><td style="text-align:right;font-weight:600;">${formatMoney(report.totalPrincipalReturned)}</td></tr>
              <tr><td style="padding:3px 0;color:#475569;">อัตรากำไรสุทธิ (Net Margin):</td><td style="text-align:right;font-weight:600;color:#059669;">${analysis.netProfitMarginPct.toFixed(1)}%</td></tr>
              <tr><td style="padding:3px 0;color:#475569;">สัดส่วนรายจ่ายต่อดอกเบี้ย:</td><td style="text-align:right;font-weight:600;">${analysis.expenseToInterestRatioPct.toFixed(1)}%</td></tr>
              <tr><td style="padding:3px 0;color:#475569;">เทียบเดือน${analysis.prevMonthName}:</td><td style="text-align:right;font-weight:600;color:${analysis.profitDiff >= 0 ? '#059669' : '#e11d48'};">${analysis.profitDiff >= 0 ? '+' : '-'}${formatMoney(Math.abs(analysis.profitDiff))} (${analysis.profitGrowthPct >= 0 ? '+' : ''}${analysis.profitGrowthPct.toFixed(1)}%)</td></tr>
            </table>
          </div>

          <div style="border:1px solid #cbd5e1;border-radius:8px;padding:12px;background:#f8fafc;">
            <div style="font-weight:700;color:#b45309;margin-bottom:6px;font-size:13px;">🥧 โครงสร้างรายได้ดอกเบี้ยตามผลิตภัณฑ์</div>
            <table style="width:100%;font-size:12px;border-collapse:collapse;">
              <tr><td style="padding:3px 0;color:#475569;">กู้ดอกสะสมรายวัน:</td><td style="text-align:right;font-weight:600;">${formatMoney(report.loanInterest + report.manualInterest)} (${analysis.loanInterestSharePct.toFixed(1)}%)</td></tr>
              <tr><td style="padding:3px 0;color:#475569;">กู้รายวัน:</td><td style="text-align:right;font-weight:600;">${formatMoney(report.dailyInterest)} (${analysis.dailyInterestSharePct.toFixed(1)}%)</td></tr>
              <tr><td style="padding:3px 0;color:#475569;">จำนำ:</td><td style="text-align:right;font-weight:600;">${formatMoney(report.pawnInterest)} (${analysis.pawnInterestSharePct.toFixed(1)}%)</td></tr>
              <tr><td style="padding:3px 0;color:#475569;">พอร์ตทำกำไรสูงสุด:</td><td style="text-align:right;font-weight:600;color:#b45309;">${escapeHtml(analysis.topProduct)}</td></tr>
              <tr><td style="padding:3px 0;color:#475569;">ผลตอบแทนต่อพอร์ต (Yield):</td><td style="text-align:right;font-weight:600;">${analysis.portfolioYieldRatePct.toFixed(1)}% / เดือน</td></tr>
            </table>
          </div>

          <div style="border:1px solid #cbd5e1;border-radius:8px;padding:12px;background:#f8fafc;">
            <div style="font-weight:700;color:#b45309;margin-bottom:6px;font-size:13px;">💸 การวิเคราะห์กระแสเงินสด (Cash Flow)</div>
            <table style="width:100%;font-size:12px;border-collapse:collapse;">
              <tr><td style="padding:3px 0;color:#475569;">เงินสดรับเข้า (Inflow):</td><td style="text-align:right;font-weight:600;color:#059669;">+${formatMoney(report.income)}</td></tr>
              <tr><td style="padding:3px 0;color:#475569;">ปล่อยกู้/จำนำใหม่ (${analysis.totalNewContractsCount} สัญญา):</td><td style="text-align:right;font-weight:600;color:#e11d48;">-${formatMoney(analysis.totalNewDisbursed)}</td></tr>
              <tr><td style="padding:3px 0;color:#475569;">รายจ่ายดำเนินงาน:</td><td style="text-align:right;font-weight:600;color:#e11d48;">-${formatMoney(report.expense)}</td></tr>
              <tr><td style="padding:3px 0;color:#475569;">กระแสเงินสดสุทธิ:</td><td style="text-align:right;font-weight:700;color:${analysis.netCashFlow >= 0 ? '#059669' : '#e11d48'};">${analysis.netCashFlow >= 0 ? '+' : '-'}${formatMoney(Math.abs(analysis.netCashFlow))}</td></tr>
            </table>
          </div>

          <div style="border:1px solid #cbd5e1;border-radius:8px;padding:12px;background:#f8fafc;">
            <div style="font-weight:700;color:#b45309;margin-bottom:6px;font-size:13px;">🛡️ คุณภาพพอร์ต & ความเสี่ยงหนี้ค้างชำระ</div>
            <table style="width:100%;font-size:12px;border-collapse:collapse;">
              <tr><td style="padding:3px 0;color:#475569;">เงินต้นคงค้างในระบบรวม:</td><td style="text-align:right;font-weight:600;">${formatMoney(analysis.totalActivePrincipal)} (${analysis.totalActiveContracts} สัญญา)</td></tr>
              <tr><td style="padding:3px 0;color:#475569;">ดอกเบี้ยค้างรับสะสม:</td><td style="text-align:right;font-weight:600;color:#b45309;">${formatMoney(analysis.totalUnpaidInterest)}</td></tr>
              <tr><td style="padding:3px 0;color:#475569;">สัญญาที่เกินกำหนดชำระ:</td><td style="text-align:right;font-weight:600;color:${analysis.totalOverdueContracts > 0 ? '#e11d48' : '#059669'};">${analysis.totalOverdueContracts} สัญญา (${analysis.overdueRatePct.toFixed(1)}%)</td></tr>
              <tr><td style="padding:3px 0;color:#475569;">ลูกค้าที่สร้างรายได้สูงสุด:</td><td style="text-align:right;font-weight:600;">${analysis.topCustomers.length > 0 ? escapeHtml(analysis.topCustomers[0].name) : '-'}</td></tr>
            </table>
          </div>
        </div>
      </div>
    `);

    blocks.push(`
      <div style="margin-bottom:18px;border:1px solid #a7f3d0;background:#ecfdf5;border-radius:8px;padding:12px 14px;">
        <div style="font-weight:700;color:#065f46;margin-bottom:6px;font-size:13px;">💡 สรุปผลการวิเคราะห์และข้อเสนอแนะเชิงกลยุทธ์ (Executive Summary)</div>
        <ul style="margin:0;padding-left:18px;font-size:12px;color:#0f172a;line-height:1.55;">
          ${analysis.insights.map(item => `<li style="margin-bottom:4px;">${escapeHtml(item)}</li>`).join('')}
        </ul>
      </div>
    `);
  }

  // Transaction Table Blocks (chunked so multi-page PDFs never cut rows)
  const sectionNum = includeAnalysis ? 3 : 2;
  const tableHeadHtml = `
    <thead>
      <tr style="background:#1e293b;color:#ffffff;">
        <th style="border:1px solid #1e293b;padding:7px 8px;text-align:center;width:38px;">#</th>
        <th style="border:1px solid #1e293b;padding:7px 8px;text-align:left;width:85px;">วันที่</th>
        <th style="border:1px solid #1e293b;padding:7px 8px;text-align:left;width:105px;">ประเภท</th>
        <th style="border:1px solid #1e293b;padding:7px 8px;text-align:left;width:130px;">ลูกค้า</th>
        <th style="border:1px solid #1e293b;padding:7px 8px;text-align:left;">รายละเอียด / หมายเหตุ</th>
        <th style="border:1px solid #1e293b;padding:7px 8px;text-align:right;width:105px;">จำนวนเงิน</th>
      </tr>
    </thead>
  `;

  if (report.txs.length === 0) {
    blocks.push(`
      <div style="margin-bottom:18px;">
        <div style="font-size:15px;font-weight:700;color:#0f172a;border-left:4px solid #3b82f6;padding-left:10px;margin-bottom:10px;">
          ส่วนที่ ${sectionNum}: รายการธุรกรรมประจำเดือน (0 รายการ)
        </div>
        <table style="width:100%;border-collapse:collapse;font-size:12px;">
          ${tableHeadHtml}
          <tbody>
            <tr><td colspan="6" style="text-align:center;padding:20px;color:#64748b;border:1px solid #cbd5e1;">ไม่มีรายการธุรกรรมในเดือนนี้</td></tr>
          </tbody>
        </table>
      </div>
    `);
  } else {
    const firstChunkSize = includeAnalysis ? 8 : 15;
    const nextChunkSize = 18;
    const chunks = [];
    chunks.push({ startIdx: 0, items: report.txs.slice(0, firstChunkSize) });
    for (let i = firstChunkSize; i < report.txs.length; i += nextChunkSize) {
      chunks.push({ startIdx: i, items: report.txs.slice(i, i + nextChunkSize) });
    }

    chunks.forEach((chunk, cIdx) => {
      const isLast = cIdx === chunks.length - 1;
      const rowsHtml = chunk.items.map((t, offset) => {
        const cust = report.customers.find(c => c.id === t.customerId);
        const isIncome = t.type !== 'expense';
        return `
          <tr>
            <td style="border:1px solid #cbd5e1;padding:6px 8px;text-align:center;">${chunk.startIdx + offset + 1}</td>
            <td style="border:1px solid #cbd5e1;padding:6px 8px;white-space:nowrap;">${formatDate(t.date)}</td>
            <td style="border:1px solid #cbd5e1;padding:6px 8px;">${escapeHtml(typeLabels[t.type] || t.type)}</td>
            <td style="border:1px solid #cbd5e1;padding:6px 8px;">${escapeHtml(cust?.name || '-')}</td>
            <td style="border:1px solid #cbd5e1;padding:6px 8px;color:#334155;">${escapeHtml(t.note || '-')}</td>
            <td style="border:1px solid #cbd5e1;padding:6px 8px;text-align:right;font-weight:600;color:${isIncome ? '#059669' : '#e11d48'};white-space:nowrap;">
              ${isIncome ? '+' : '-'}${formatMoney(t.amount)}
            </td>
          </tr>
        `;
      }).join('');

      const tfootHtml = isLast ? `
        <tfoot>
          <tr style="background:#f1f5f9;font-weight:700;">
            <td colspan="5" style="border:1px solid #cbd5e1;padding:8px;text-align:right;">รายรับสุทธิหักรายจ่าย (Cash Net):</td>
            <td style="border:1px solid #cbd5e1;padding:8px;text-align:right;color:#0f172a;">${formatMoney(report.income - report.expense)}</td>
          </tr>
        </tfoot>
      ` : '';

      blocks.push(`
        <div style="margin-bottom:16px;">
          <div style="font-size:15px;font-weight:700;color:#0f172a;border-left:4px solid #3b82f6;padding-left:10px;margin-bottom:10px;">
            ส่วนที่ ${sectionNum}: รายการธุรกรรมประจำเดือน (${report.txs.length} รายการ)${cIdx > 0 ? ' (ต่อ)' : ''}
          </div>
          <table style="width:100%;border-collapse:collapse;font-size:12px;">
            ${tableHeadHtml}
            <tbody>${rowsHtml}</tbody>
            ${tfootHtml}
          </table>
        </div>
      `);
    });
  }

  // Final Block: Signature Footer
  blocks.push(`
    <div style="margin-top:24px;display:flex;justify-content:space-between;align-items:flex-end;font-size:11.5px;color:#64748b;">
      <div>เอกสารฉบับนี้สร้างโดยระบบอัตโนมัติ Vider Finance Dashboard</div>
      <div style="text-align:center;min-width:210px;">
        <div style="border-bottom:1px dotted #64748b;height:28px;margin-bottom:4px;"></div>
        <div style="color:#0f172a;font-weight:600;">(${escapeHtml(managerName)})</div>
        <div>ผู้จัดการ / ผู้ตรวจสอบรายงาน</div>
      </div>
    </div>
  `);

  return blocks;
}

async function exportReportToPDF() {
  const month = parseInt(document.getElementById('reportMonth').value, 10);
  const thYear = parseInt(document.getElementById('reportYear').value, 10);
  const includeAnalysis = Boolean(document.getElementById('includeFinancialAnalysis')?.checked);

  renderReportPage();

  const report = computeMonthlyReportData(month, thYear);
  const fileBaseName = `รายงานการเงิน_ViderFinance_${report.monthName}_${report.thYear}${includeAnalysis ? '_พร้อมวิเคราะห์การเงิน' : ''}`;
  const blocks = buildReportPdfBlocks(report, includeAnalysis);

  const pdfBtn = document.getElementById('exportPdfBtn');
  const origBtnHtml = pdfBtn ? pdfBtn.innerHTML : '';

  const JsPDFClass = window.jspdf?.jsPDF || window.jsPDF;

  if (typeof window.html2canvas === 'function' && typeof JsPDFClass === 'function') {
    let curtainEl = null;
    let stageEl = null;
    try {
      if (pdfBtn) {
        pdfBtn.disabled = true;
        pdfBtn.innerHTML = '<span>⏳</span> กำลังสร้าง PDF...';
      }

      // Curtain keeps UI clean while stage renders at opacity: 1 inside viewport (0, 0)
      curtainEl = document.createElement('div');
      curtainEl.style.cssText = 'position:fixed;inset:0;z-index:20000;background:rgba(10,14,26,0.92);display:flex;flex-direction:column;align-items:center;justify-content:center;color:#f1f5f9;font-family:var(--font-body);';
      curtainEl.innerHTML = '<div style="font-size:2.5rem;margin-bottom:12px;">📄</div><div style="font-size:1.15rem;font-weight:600;">กำลังสร้างไฟล์ PDF รายงานประจำเดือน...</div><div style="font-size:0.85rem;color:#94a3b8;margin-top:4px;">กรุณารอสักครู่</div>';
      document.body.appendChild(curtainEl);

      stageEl = document.createElement('div');
      stageEl.style.cssText = 'position:fixed;top:0;left:0;width:794px;z-index:19999;background:#ffffff;color:#0f172a;opacity:1;pointer-events:none;font-family:"Noto Sans Thai","Inter",sans-serif;';
      document.body.appendChild(stageEl);

      if (document.fonts && document.fonts.ready) {
        await document.fonts.ready;
      }

      // Paginate blocks onto A4 sheets (794 x 1123 px, usable inner height ~1015 px)
      const PAGE_WIDTH = 794;
      const PAGE_HEIGHT = 1123;
      const MAX_INNER_HEIGHT = 1015;
      const pages = [];

      const createA4Page = () => {
        const page = document.createElement('div');
        page.style.cssText = `width:${PAGE_WIDTH}px;height:${PAGE_HEIGHT}px;padding:36px 42px 52px 42px;background:#ffffff;color:#0f172a;box-sizing:border-box;position:relative;overflow:hidden;font-family:'Noto Sans Thai','Inter',sans-serif;line-height:1.45;`;
        const bodyWrap = document.createElement('div');
        page.appendChild(bodyWrap);
        stageEl.appendChild(page);
        pages.push({ page, bodyWrap });
        return pages[pages.length - 1];
      };

      let currentPage = createA4Page();

      for (const blockHtml of blocks) {
        const wrapper = document.createElement('div');
        wrapper.innerHTML = blockHtml.trim();
        const blockEl = wrapper.firstElementChild || wrapper;
        currentPage.bodyWrap.appendChild(blockEl);

        if (currentPage.bodyWrap.offsetHeight > MAX_INNER_HEIGHT && currentPage.bodyWrap.children.length > 1) {
          currentPage.bodyWrap.removeChild(blockEl);
          currentPage = createA4Page();
          currentPage.bodyWrap.appendChild(blockEl);
        }
      }

      // Add page numbers to every A4 sheet
      pages.forEach((p, idx) => {
        const pageNumEl = document.createElement('div');
        pageNumEl.style.cssText = 'position:absolute;bottom:18px;left:42px;right:42px;display:flex;justify-content:space-between;font-size:10.5px;color:#94a3b8;border-top:1px solid #e2e8f0;padding-top:6px;';
        pageNumEl.innerHTML = `<span>Vider Finance – รายงานประจำเดือน${report.monthName} ${report.thYear}</span><span>หน้า ${idx + 1} / ${pages.length}</span>`;
        p.page.appendChild(pageNumEl);
      });

      // Small delay for layout & font paint
      await new Promise(r => setTimeout(r, 120));

      const pdf = new JsPDFClass({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });

      for (let i = 0; i < pages.length; i++) {
        // Position only the active page at (0, 0) in stageEl so html2canvas captures exact bounds
        pages.forEach((p, j) => {
          p.page.style.display = i === j ? 'block' : 'none';
        });
        const canvas = await window.html2canvas(pages[i].page, {
          scale: 2,
          useCORS: true,
          backgroundColor: '#ffffff',
          width: PAGE_WIDTH,
          height: PAGE_HEIGHT,
          windowWidth: PAGE_WIDTH,
          windowHeight: PAGE_HEIGHT,
          scrollX: 0,
          scrollY: 0,
          logging: false,
        });
        const imgData = canvas.toDataURL('image/jpeg', 0.95);
        if (i > 0) pdf.addPage();
        pdf.addImage(imgData, 'JPEG', 0, 0, 210, 297);
      }

      const pdfBlob = pdf.output('blob');
      triggerBlobDownload(pdfBlob, `${fileBaseName}.pdf`);
      showToast(`ดาวน์โหลดไฟล์ PDF (${fileBaseName}.pdf) สำเร็จ`);
      return;
    } catch (err) {
      console.error('Direct PDF generation failed, falling back to Print dialog:', err);
    } finally {
      if (stageEl && stageEl.parentNode) stageEl.remove();
      if (curtainEl && curtainEl.parentNode) curtainEl.remove();
      if (pdfBtn) {
        pdfBtn.disabled = false;
        pdfBtn.innerHTML = origBtnHtml;
      }
    }
  }

  // Offline Fallback: Open clean print window (Save as PDF)
  const printWin = window.open('', '_blank', 'width=900,height=800');
  if (!printWin) {
    showToast('กรุณาอนุญาตป๊อปอัปเพื่อบันทึกเป็น PDF', 'error');
    return;
  }
  printWin.document.write(`
    <!DOCTYPE html>
    <html lang="th">
    <head>
      <meta charset="UTF-8" />
      <title>${fileBaseName}</title>
      <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+Thai:wght@300;400;500;600;700&family=Inter:wght@400;600;700&display=swap" rel="stylesheet" />
      <style>
        @page { size: A4 portrait; margin: 12mm; }
        body { margin: 0; padding: 16px; background: #fff; color: #0f172a; font-family: 'Noto Sans Thai', 'Inter', sans-serif; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      </style>
    </head>
    <body>
      ${blocks.join('')}
      <script>
        window.onload = () => { setTimeout(() => { window.print(); }, 400); };
      </script>
    </body>
    </html>
  `);
  printWin.document.close();
  showToast('เปิดหน้าต่างสำหรับบันทึก PDF แล้ว');
}

window.exportReportToExcel = exportReportToExcel;
window.exportReportToPDF = exportReportToPDF;

document.getElementById('exportExcelBtn')?.addEventListener('click', exportReportToExcel);
document.getElementById('exportPdfBtn')?.addEventListener('click', exportReportToPDF);

// ============================================================

// ============================================================
// Daily Loans
// ============================================================
function renderDaily(filter = '', statusFilter = '') {
  let dailyLoans = DB.get('daily_loans');
  const customers = DB.get('customers');

  if (filter) {
    const q = filter.toLowerCase();
    dailyLoans = dailyLoans.filter(l => {
      const c = customers.find(c => c.id === l.customerId);
      return (c?.name || '').toLowerCase().includes(q) || l.id.includes(q);
    });
  }

  // Compute live status
  dailyLoans = dailyLoans.map(d => {
    let liveStatus = d.status;
    if (liveStatus !== 'paid') {
      const endDate = d.status === 'paid' && d.closedDate ? d.closedDate : today();
      const elapsedDays = daysBetween(d.date, endDate);
      const expectedPaid = Math.min(d.totalAmount, elapsedDays * d.dailyInstallment);
      const actualPaid = d.paidAmount || 0;
      if (actualPaid < expectedPaid) liveStatus = 'overdue';
      else liveStatus = 'active';
    }
    return { ...d, _liveStatus: liveStatus };
  });

  if (statusFilter) dailyLoans = dailyLoans.filter(l => l._liveStatus === statusFilter);

  const tbody = document.getElementById('dailyTableBody');
  if (dailyLoans.length === 0) {
    tbody.innerHTML = '<tr class="empty-row"><td colspan="10">ยังไม่มีสัญญากู้รายวัน</td></tr>';
    return;
  }

  tbody.innerHTML = dailyLoans.map((d, i) => {
    const cust = customers.find(c => c.id === d.customerId);
    const paid = d.paidAmount || 0;
    const remaining = d.totalAmount - paid;
    const liveStatus = d._liveStatus;
    const statusLabel = { active: 'กำลังดำเนินการ', overdue: 'ค้างชำระ', paid: 'ชำระครบแล้ว' };
    const statusBadge = { active: 'badge-active', overdue: 'badge-overdue', paid: 'badge-paid' };

    return `
      <tr>
        <td>${i + 1}</td>
        <td><strong>${cust?.name || 'ไม่ระบุ'}</strong></td>
        <td style="color:var(--accent-rose);font-weight:600">${formatMoney(d.amount)}</td>
        <td style="color:var(--accent-gold);font-weight:600">${formatMoney(d.totalAmount)}</td>
        <td>${d.durationDays} วัน</td>
        <td style="color:var(--accent-blue)">${formatMoney(d.dailyInstallment)}</td>
        <td style="color:var(--text-secondary)">${formatMoney(paid)}</td>
        <td style="color:${remaining > 0 ? 'var(--accent-rose)' : 'var(--text-muted)'}; font-weight:600">${formatMoney(remaining)}</td>
        <td><span class="type-badge ${statusBadge[liveStatus] || 'badge-active'}">${statusLabel[liveStatus] || liveStatus}</span></td>
        <td>
          <div class="action-btns">
            ${liveStatus !== 'paid' ? `<button class="btn-icon pay" title="รับเงิน" onclick="openPayDaily('${d.id}')">💵</button>` : ''}
            <button class="btn-icon edit" title="แก้ไข" onclick="editDaily('${d.id}')">✏️</button>
            <button class="btn-icon delete" title="ลบ" onclick="deleteDaily('${d.id}')">🗑️</button>
          </div>
        </td>
      </tr>`;
  }).join('');
}

document.getElementById('dailySearch').addEventListener('input', (e) => {
  renderDaily(e.target.value, document.getElementById('dailyStatusFilter').value);
});
document.getElementById('dailyStatusFilter').addEventListener('change', (e) => {
  renderDaily(document.getElementById('dailySearch').value, e.target.value);
});
document.getElementById('addDailyBtn').addEventListener('click', () => openDailyModal());

function openDailyModal(data = null) {
  populateCustomerDropdowns();
  const modal = document.getElementById('dailyModal');
  document.getElementById('dailyModalTitle').textContent = data ? 'แก้ไขเงินกู้รายวัน' : 'เพิ่มเงินกู้รายวัน';
  document.getElementById('dailyId').value = data?.id || '';
  document.getElementById('dailyCustomer').value = data?.customerId || '';
  document.getElementById('dailyAmount').value = data?.amount || '';
  document.getElementById('dailyRate').value = data?.rate != null ? +(data.rate * 100).toFixed(2) : 20;
  document.getElementById('dailyDuration').value = data?.durationDays || 12;
  document.getElementById('dailyDate').value = data?.date || today();
  document.getElementById('dailyNote').value = data?.note || '';
  updateDailyPreview();
  modal.showModal();
}

function updateDailyPreview() {
  const amount = parseFloat(document.getElementById('dailyAmount').value) || 0;
  const ratePct = parseFloat(document.getElementById('dailyRate').value) || 0;
  const duration = parseInt(document.getElementById('dailyDuration').value) || 1;
  const totalAmount = amount + (amount * (ratePct / 100));
  const dailyInstallment = totalAmount / duration;
  document.getElementById('dailyPreview').textContent = `${formatMoney(dailyInstallment)} / ${formatMoney(totalAmount)}`;
}

document.getElementById('dailyAmount').addEventListener('input', updateDailyPreview);
document.getElementById('dailyRate').addEventListener('input', updateDailyPreview);
document.getElementById('dailyDuration').addEventListener('input', updateDailyPreview);
document.getElementById('closeDailyModal').addEventListener('click', () => document.getElementById('dailyModal').close());
document.getElementById('cancelDaily').addEventListener('click', () => document.getElementById('dailyModal').close());

document.getElementById('dailyForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const id = document.getElementById('dailyId').value || genId();
  const dailyLoans = DB.get('daily_loans');
  const existing = dailyLoans.findIndex(l => l.id === id);

  const ratePct = parseFloat(document.getElementById('dailyRate').value);
  if (!ratePct || ratePct <= 0) { showToast('กรุณากรอกอัตราดอกเบี้ย', 'error'); return; }

  const amount = parseFloat(document.getElementById('dailyAmount').value);
  if (!amount || amount <= 0) { showToast('กรุณากรอกจำนวนเงินกู้', 'error'); return; }

  const duration = parseInt(document.getElementById('dailyDuration').value);
  if (!duration || duration <= 0) { showToast('กรุณากรอกระยะเวลา', 'error'); return; }

  const totalAmount = amount + (amount * (ratePct / 100));
  const dailyInstallment = totalAmount / duration;

  const data = {
    id,
    customerId: document.getElementById('dailyCustomer').value,
    amount,
    rate: ratePct / 100,
    durationDays: duration,
    totalAmount,
    dailyInstallment,
    date: document.getElementById('dailyDate').value,
    note: document.getElementById('dailyNote').value,
    status: existing >= 0 ? dailyLoans[existing].status : 'active',
    paidAmount: existing >= 0 ? (dailyLoans[existing].paidAmount || 0) : 0,
    createdAt: existing >= 0 ? dailyLoans[existing].createdAt : Date.now(),
  };

  if (!data.customerId) { showToast('กรุณาเลือกลูกค้า', 'error'); return; }

  if (existing >= 0) dailyLoans[existing] = data;
  else dailyLoans.push(data);
  DB.set('daily_loans', dailyLoans);

  document.getElementById('dailyModal').close();
  renderDaily();
  updateBadges();
  showToast(existing >= 0 ? 'แก้ไขสัญญาแล้ว' : 'เพิ่มเงินกู้รายวันแล้ว');
});

function editDaily(id) {
  const l = DB.get('daily_loans').find(l => l.id === id);
  if (l) openDailyModal(l);
}

function deleteDaily(id) {
  openConfirm('ต้องการลบเงินกู้รายวันนี้ใช่ไหม?', () => {
    DB.set('daily_loans', DB.get('daily_loans').filter(l => l.id !== id));
    renderDaily();
    updateBadges();
    showToast('ลบรายการแล้ว');
  });
}

let _payDailyContext = null;

function openPayDaily(id) {
  const item = DB.get('daily_loans').find(l => l.id === id);
  if (!item) return;
  const cust = DB.get('customers').find(c => c.id === item.customerId);
  const paid = item.paidAmount || 0;
  const remaining = item.totalAmount - paid;
  const elapsedDays = daysBetween(item.date, today());
  const expectedPaid = Math.min(item.totalAmount, elapsedDays * item.dailyInstallment);
  const overdueAmount = Math.max(0, expectedPaid - paid);

  _payDailyContext = { id, item, remaining };

  document.getElementById('payDailyDetail').innerHTML = `
    <strong>ลูกค้า:</strong> ${cust?.name || 'ไม่ระบุ'}<br>
    <strong>ยอดกู้รวมดอก:</strong> ${formatMoney(item.totalAmount)}<br>
    <strong>ยอดส่งต่อวัน:</strong> ${formatMoney(item.dailyInstallment)}<br>
    <strong>ส่งแล้ว:</strong> ${formatMoney(paid)} | <strong>คงเหลือ:</strong> <span style="color:var(--accent-rose)">${formatMoney(remaining)}</span><br>
    ${overdueAmount > 0 ? `<strong style="color:var(--accent-rose)">ยอดที่ควรส่งถึงวันนี้:</strong> ${formatMoney(expectedPaid)} (ค้าง ${formatMoney(overdueAmount)})<br>` : ''}
  `;

  document.getElementById('payDailyAmount').value = overdueAmount > 0 ? overdueAmount : item.dailyInstallment;
  document.getElementById('payDailyNote').value = '';
  document.getElementById('payDailyDate').value = today();
  document.getElementById('payDailyModal').showModal();
}

document.getElementById('closePayDailyModal').addEventListener('click', () => document.getElementById('payDailyModal').close());
document.getElementById('cancelPayDaily').addEventListener('click', () => document.getElementById('payDailyModal').close());

document.getElementById('confirmPayDaily').addEventListener('click', () => {
  if (!_payDailyContext) return;
  const amount = parseFloat(document.getElementById('payDailyAmount').value);
  if (!amount || amount <= 0) { showToast('กรุณากรอกจำนวนเงิน', 'error'); return; }

  const { id, item, remaining } = _payDailyContext;

  const dateStr = document.getElementById('payDailyDate').value || today();
  
  if (amount > remaining) {

    showToast(`รับเงินได้สูงสุดไม่เกินยอดคงเหลือ (${formatMoney(remaining)})`, 'error');
    return;
  }

  const cust = DB.get('customers').find(c => c.id === item.customerId);
  const note = document.getElementById('payDailyNote').value || `รับกู้รายวัน - ${cust?.name || ''}`;

  // Update loan
  const dailyLoans = DB.get('daily_loans');
  const idx = dailyLoans.findIndex(l => l.id === id);
  let interestAmount = 0;
  
  if (idx >= 0) {
    const loan = dailyLoans[idx];
    const totalInt = loan.amount * loan.rate;
    interestAmount = loan.totalAmount ? amount * (totalInt / loan.totalAmount) : 0;
    
    dailyLoans[idx].paidAmount = (dailyLoans[idx].paidAmount || 0) + amount;
    if (dailyLoans[idx].paidAmount >= dailyLoans[idx].totalAmount) {
      dailyLoans[idx].status = 'paid';
      dailyLoans[idx].closedDate = dateStr;
    }
    DB.set('daily_loans', dailyLoans);
  }

  // Log transaction
  const txs = DB.get('transactions');
  txs.push({
    id: genId(),
    date: dateStr,
    type: 'daily_payment',
    customerId: item.customerId,
    refId: item.id,
    amount: amount,
    interestAmount: interestAmount,
    note: note,
    createdAt: Date.now(),
  });
  DB.set('transactions', txs);

  document.getElementById('payDailyModal').close();
  showToast(`รับเงินรายวัน ${formatMoney(amount)} แล้ว`, 'success');

  renderDaily();
  renderDashboard();
});

// Quick Add Modal
// ============================================================
document.getElementById('quickAddBtn').addEventListener('click', () => {
  document.getElementById('quickAddModal').showModal();
});
document.getElementById('closeQuickAdd').addEventListener('click', () => document.getElementById('quickAddModal').close());

document.getElementById('qa-customer').addEventListener('click', () => {
  document.getElementById('quickAddModal').close();
  navigateTo('customers');
  setTimeout(() => openCustomerModal(), 200);
});
document.getElementById('qa-loan').addEventListener('click', () => {
  document.getElementById('quickAddModal').close();
  navigateTo('loans');
  setTimeout(() => openLoanModal(), 200);
});
document.getElementById('qa-daily').addEventListener('click', () => {
  document.getElementById('quickAddModal').close();
  navigateTo('daily');
  setTimeout(() => openDailyModal(), 200);
});
document.getElementById('qa-pawn').addEventListener('click', () => {
  document.getElementById('quickAddModal').close();
  navigateTo('pawns');
  setTimeout(() => openPawnModal(), 200);
});
document.getElementById('qa-tx').addEventListener('click', () => {
  document.getElementById('quickAddModal').close();
  navigateTo('transactions');
  setTimeout(() => openTxModal(), 200);
});

// ============================================================
// Confirm Dialog
// ============================================================
let _confirmCallback = null;

function openConfirm(msg, cb) {
  document.getElementById('confirmMessage').textContent = msg;
  _confirmCallback = cb;
  document.getElementById('confirmModal').showModal();
}

document.getElementById('cancelConfirm').addEventListener('click', () => {
  document.getElementById('confirmModal').close();
  _confirmCallback = null;
});

document.getElementById('confirmDelete').addEventListener('click', () => {
  document.getElementById('confirmModal').close();
  if (_confirmCallback) _confirmCallback();
  _confirmCallback = null;
});

// Close modals on backdrop click
document.querySelectorAll('.modal').forEach(modal => {
  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.close();
  });
});

// ============================================================
// Date & Init
// ============================================================
function updateCurrentDate() {
  const d = new Date();
  const thDays = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัส', 'ศุกร์', 'เสาร์'];
  const thMonths = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
  document.getElementById('currentDate').textContent =
    `${thDays[d.getDay()]} ${d.getDate()} ${thMonths[d.getMonth()]} ${d.getFullYear() + 543}`;
}

// ============================================================
// App Init
// ============================================================
function init() {
  updateCurrentDate();
  navigateTo('dashboard');
  updateBadges();

  // Auto-refresh date every minute
  setInterval(updateCurrentDate, 60000);

  console.log('%c💰 Vider Finance Dashboard', 'font-size:18px;font-weight:bold;color:#f59e0b');
  console.log('%cLoan rate: 20% / 10 days | Pawn rate: 5% / 10 days', 'color:#94a3b8');
}

init();


// ============================================================
// Fallback Timeout for Loading Overlay
// ============================================================
setTimeout(() => {
  const loader = document.getElementById('appLoadingOverlay');
  if (loader && loader.style.display !== 'none') {
    console.warn("Firebase or Data fetch timeout. Falling back to offline mode.");
    loader.style.display = 'none';
    if (typeof showToast === 'function') {
      showToast('เชื่อมต่อฐานข้อมูลช้า ระบบสลับเป็นโหมดออฟไลน์', 'error');
    }
    triggerRender();
  }
}, 4000);

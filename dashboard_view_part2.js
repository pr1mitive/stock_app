/**
 * 在庫推移ダッシュボード - Part 2（グラフ・UI更新）
 * Version: 1.0
 * 
 * グラフ描画とUI更新機能
 * 
 * @requires dashboard_view_part1.js
 */

(function() {
  'use strict';

  const CONFIG = window.INVENTORY_CONFIG;
  const Utils = window.InventoryUtils;

  /**
   * 在庫推移グラフを更新
   */
  window.updateInventoryChart = function(summaryData, safetyStock) {
    const canvas = document.getElementById('inventory-chart');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const today = Utils.formatDate(new Date());

    // 日付とデータを抽出
    const labels = summaryData.map(d => d.date);
    const endingQty = summaryData.map(d => d.ending_qty);
    const projectedQty = summaryData.map(d => d.projected_ending_qty);
    const safetyLine = summaryData.map(() => safetyStock);

    // 過去と未来を分ける
    const todayIndex = labels.indexOf(today);

    // 既存のチャートを破棄
    if (window.lineChart) {
      window.lineChart.destroy();
    }

    // チャートを作成
    window.lineChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: labels,
        datasets: [
          {
            label: '実績在庫',
            data: endingQty,
            borderColor: '#4CAF50',
            backgroundColor: 'rgba(76, 175, 80, 0.1)',
            borderWidth: 3,
            pointRadius: 0,
            pointHoverRadius: 5,
            tension: 0.1,
            fill: true
          },
          {
            label: '予測在庫',
            data: projectedQty,
            borderColor: '#2196F3',
            backgroundColor: 'rgba(33, 150, 243, 0.05)',
            borderWidth: 2,
            borderDash: [5, 5],
            pointRadius: 0,
            pointHoverRadius: 5,
            tension: 0.1,
            fill: false
          },
          {
            label: '安全在庫',
            data: safetyLine,
            borderColor: '#FF9800',
            borderWidth: 2,
            borderDash: [10, 5],
            pointRadius: 0,
            pointHoverRadius: 0,
            tension: 0,
            fill: false
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
          mode: 'index',
          intersect: false
        },
        plugins: {
          legend: {
            display: false
          },
          tooltip: {
            backgroundColor: 'rgba(0, 0, 0, 0.8)',
            padding: 12,
            titleColor: '#fff',
            bodyColor: '#fff',
            callbacks: {
              title: function(context) {
                return context[0].label;
              },
              label: function(context) {
                const label = context.dataset.label || '';
                const value = context.parsed.y;
                return label + ': ' + value.toLocaleString() + '個';
              }
            }
          }
        },
        scales: {
          x: {
            grid: {
              display: true,
              color: 'rgba(0, 0, 0, 0.05)'
            },
            ticks: {
              maxRotation: 45,
              minRotation: 45,
              callback: function(value, index) {
                const date = labels[index];
                // 7日ごとに表示
                if (index % 7 === 0 || index === todayIndex) {
                  return date.substring(5); // MM-DD
                }
                return '';
              }
            }
          },
          y: {
            beginAtZero: true,
            grid: {
              display: true,
              color: 'rgba(0, 0, 0, 0.1)'
            },
            ticks: {
              callback: function(value) {
                return value.toLocaleString();
              }
            }
          }
        },
        // 今日の線を表示
        annotation: todayIndex >= 0 ? {
          annotations: {
            line1: {
              type: 'line',
              xMin: todayIndex,
              xMax: todayIndex,
              borderColor: 'rgba(255, 0, 0, 0.3)',
              borderWidth: 2,
              borderDash: [5, 5],
              label: {
                content: '今日',
                enabled: true,
                position: 'top'
              }
            }
          }
        } : undefined
      }
    });
  };

  /**
   * 入出庫推移グラフを更新
   */
  window.updateTransactionChart = function(summaryData) {
    const canvas = document.getElementById('transaction-chart');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const today = Utils.formatDate(new Date());

    // 過去14日分のデータを抽出
    const todayIndex = summaryData.findIndex(d => d.date === today);
    const startIndex = Math.max(0, todayIndex - 14);
    const endIndex = todayIndex + 1;
    const recentData = summaryData.slice(startIndex, endIndex);

    const labels = recentData.map(d => d.date);
    const receivedQty = recentData.map(d => d.actual_received_qty);
    const issuedQty = recentData.map(d => d.actual_issued_qty);

    // 既存のチャートを破棄
    if (window.barChart) {
      window.barChart.destroy();
    }

    // チャートを作成
    window.barChart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [
          {
            label: '入庫',
            data: receivedQty,
            backgroundColor: '#4CAF50',
            borderColor: '#388E3C',
            borderWidth: 1
          },
          {
            label: '出庫',
            data: issuedQty,
            backgroundColor: '#F44336',
            borderColor: '#D32F2F',
            borderWidth: 1
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
          mode: 'index',
          intersect: false
        },
        plugins: {
          legend: {
            display: false
          },
          tooltip: {
            backgroundColor: 'rgba(0, 0, 0, 0.8)',
            padding: 12,
            callbacks: {
              label: function(context) {
                const label = context.dataset.label || '';
                const value = context.parsed.y;
                return label + ': ' + value.toLocaleString() + '個';
              }
            }
          }
        },
        scales: {
          x: {
            grid: {
              display: false
            },
            ticks: {
              callback: function(value, index) {
                const date = labels[index];
                return date.substring(5); // MM-DD
              }
            }
          },
          y: {
            beginAtZero: true,
            grid: {
              display: true,
              color: 'rgba(0, 0, 0, 0.1)'
            },
            ticks: {
              callback: function(value) {
                return value.toLocaleString();
              }
            }
          }
        }
      }
    });
  };

  /**
   * アラートを更新
   */
  window.updateAlerts = function(summaryData, balance) {
    const alertSection = document.getElementById('alert-section');
    const today = Utils.formatDate(new Date());
    const alerts = [];

    // 在庫切れ予測を検出
    for (const data of summaryData) {
      if (data.date > today && data.projected_ending_qty <= 0) {
        const daysUntil = Utils.diffDays(new Date(data.date), new Date(today));
        alerts.push({
          type: 'danger',
          icon: '🚨',
          message: `${daysUntil}日後（${data.date}）に在庫切れが予測されます`
        });
        break;
      }
    }

    // 在庫少アラート
    if (balance.alert_flag === CONFIG.ALERT_FLAGS.LOW_STOCK) {
      alerts.push({
        type: 'warning',
        icon: '⚠️',
        message: `現在在庫（${balance.current_qty}${balance.unit}）が安全在庫（${balance.safety_stock}${balance.unit}）を下回っています`
      });
    }

    // 在庫切れアラート
    if (balance.alert_flag === CONFIG.ALERT_FLAGS.OUT_OF_STOCK) {
      alerts.push({
        type: 'danger',
        icon: '❌',
        message: `在庫切れが発生しています`
      });
    }

    // 予定入出庫の通知
    const upcomingTransactions = summaryData.filter(d => 
      d.date > today && 
      (d.planned_received_qty > 0 || d.planned_issued_qty > 0)
    ).slice(0, 3);

    upcomingTransactions.forEach(data => {
      const daysUntil = Utils.diffDays(new Date(data.date), new Date(today));
      if (data.planned_received_qty > 0) {
        alerts.push({
          type: 'info',
          icon: '📥',
          message: `${daysUntil}日後（${data.date}）に入庫予定: ${data.planned_received_qty}${balance.unit}`
        });
      }
      if (data.planned_issued_qty > 0) {
        alerts.push({
          type: 'info',
          icon: '📤',
          message: `${daysUntil}日後（${data.date}）に出庫予定: ${data.planned_issued_qty}${balance.unit}`
        });
      }
    });

    // アラートを表示
    if (alerts.length > 0) {
      alertSection.innerHTML = alerts.map(alert => `
        <div class="alert alert-${alert.type}">
          <span class="alert-icon">${alert.icon}</span>
          <span class="alert-message">${alert.message}</span>
        </div>
      `).join('');
      alertSection.style.display = 'block';
    } else {
      alertSection.style.display = 'none';
    }
  };

  /**
   * 取引履歴を更新
   */
  window.updateTransactionHistory = function(transactions) {
    const historyList = document.getElementById('transaction-history');

    if (transactions.length === 0) {
      historyList.innerHTML = '<div class="history-empty">取引履歴がありません</div>';
      return;
    }

    historyList.innerHTML = transactions.map(tx => {
      const typeClass = tx.transaction_type === '入庫' ? 'type-received' : 'type-issued';
      const statusClass = tx.status === '確定' ? 'status-confirmed' : 'status-planned';
      const costText = tx.unit_cost > 0 ? `単価: ${tx.unit_cost.toLocaleString()}円` : '-';

      return `
        <div class="history-item">
          <div class="history-date">${tx.transaction_date}</div>
          <div class="history-id">${tx.transaction_id}</div>
          <div class="history-type ${typeClass}">${tx.transaction_type}</div>
          <div class="history-status ${statusClass}">${tx.status}</div>
          <div class="history-quantity">${tx.quantity.toLocaleString()}個</div>
          <div class="history-cost">${costText}</div>
          <div class="history-remarks">${tx.remarks || '-'}</div>
        </div>
      `;
    }).join('');
  };

  /**
   * 初期メッセージを表示
   */
  window.showInitialMessage = function() {
    document.getElementById('initial-message').style.display = 'block';
    document.getElementById('dashboard-content').style.display = 'none';
    document.getElementById('dashboard-loading').style.display = 'none';
    document.getElementById('error-message').style.display = 'none';
  };

  /**
   * 初期メッセージを非表示
   */
  window.hideInitialMessage = function() {
    document.getElementById('initial-message').style.display = 'none';
    document.getElementById('dashboard-content').style.display = 'block';
  };

  /**
   * ローディングを表示
   */
  window.showLoading = function() {
    document.getElementById('dashboard-loading').style.display = 'flex';
    document.getElementById('error-message').style.display = 'none';
  };

  /**
   * ローディングを非表示
   */
  window.hideLoading = function() {
    document.getElementById('dashboard-loading').style.display = 'none';
  };

  /**
   * エラーメッセージを表示
   */
  window.showError = function(message) {
    const errorElement = document.getElementById('error-message');
    errorElement.textContent = '❌ ' + message;
    errorElement.style.display = 'block';
    document.getElementById('initial-message').style.display = 'none';
    document.getElementById('dashboard-content').style.display = 'none';
    document.getElementById('dashboard-loading').style.display = 'none';
  };

  /**
   * ダッシュボードを更新
   */
  window.refreshDashboard = async function() {
    const itemCode = document.getElementById('item-select').value;
    const warehouse = document.getElementById('warehouse-select').value;
    const location = document.getElementById('location-select').value;

    if (!itemCode) {
      Utils.showAlert('品目を選択してください', 'warning');
      return;
    }

    if (window.InventoryDashboard && window.InventoryDashboard.loadDashboard) {
      await window.InventoryDashboard.loadDashboard(itemCode, warehouse, location);
      Utils.showAlert('ダッシュボードを更新しました', 'success');
    }
  };

  console.log('[DASHBOARD] ✅ Dashboard Part 2 loaded');

})();

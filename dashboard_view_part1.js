/**
 * 在庫推移ダッシュボード - カスタムビュー
 * Version: 1.0
 * 
 * 機能:
 * - 品目選択フィルター
 * - 在庫サマリーカード
 * - 在庫推移グラフ（過去30日〜未来90日）
 * - 入出庫推移グラフ
 * - アラート一覧
 * - 取引履歴
 * 
 * 配置先: 在庫推移サマリーアプリ(762)
 * 
 * @requires Chart.js 4.4.1+
 * @requires inventory_config.js, inventory_utils.js
 */

(function() {
  'use strict';

  const CONFIG = window.INVENTORY_CONFIG;
  const Utils = window.InventoryUtils;

  if (!CONFIG || !Utils) {
    console.error('[DASHBOARD] 依存ファイルが読み込まれていません');
    return;
  }

  console.log('[DASHBOARD] Dashboard View loaded - Version: 1.0');

  // グローバル変数
  let lineChart = null;
  let barChart = null;
  let selectedItem = null;

  /**
   * カスタムビューを表示
   */
  kintone.events.on('app.record.index.show', async function(event) {
    // カスタムビューの場合のみ実行
    if (event.viewType !== 'custom') {
      return event;
    }

    try {
      Utils.log('ダッシュボード表示開始');

      // ダッシュボードHTMLを構築
      const dashboardHtml = buildDashboardHtml();
      
      // カスタムビューにHTMLを挿入
      const spaceElement = kintone.app.getHeaderSpaceElement();
      if (spaceElement) {
        spaceElement.innerHTML = dashboardHtml;
      }

      // Chart.js が読み込まれているか確認
      if (typeof Chart === 'undefined') {
        Utils.error('Chart.js が読み込まれていません');
        showError('Chart.js ライブラリが必要です。アプリ設定で CDN を追加してください。');
        return event;
      }

      // 品目一覧を取得
      await loadItemList();

      // イベントリスナーを設定
      setupEventListeners();

      Utils.log('✅ ダッシュボード表示完了');

    } catch (error) {
      Utils.error('ダッシュボード表示エラー:', error);
      showError('ダッシュボードの表示に失敗しました: ' + error.message);
    }

    return event;
  });

  /**
   * ダッシュボードHTMLを構築
   */
  function buildDashboardHtml() {
    return `
      <div class="inventory-dashboard">
        <!-- ヘッダー -->
        <div class="dashboard-header">
          <h2 class="dashboard-title">📊 在庫推移ダッシュボード</h2>
        </div>

        <!-- 検索フィルター -->
        <div class="dashboard-filter">
          <div class="filter-group">
            <label for="item-select">品目:</label>
            <select id="item-select" class="filter-select">
              <option value="">品目を選択してください</option>
            </select>
          </div>
          <div class="filter-group">
            <label for="warehouse-select">倉庫:</label>
            <select id="warehouse-select" class="filter-select" disabled>
              <option value="">すべて</option>
            </select>
          </div>
          <div class="filter-group">
            <label for="location-select">ロケーション:</label>
            <select id="location-select" class="filter-select" disabled>
              <option value="">すべて</option>
            </select>
          </div>
          <button id="refresh-btn" class="btn-primary">🔄 更新</button>
        </div>

        <!-- 初期メッセージ -->
        <div id="initial-message" class="initial-message">
          <div class="message-icon">📦</div>
          <h3>品目を選択してください</h3>
          <p>上記のドロップダウンから品目を選択すると、在庫推移グラフが表示されます。</p>
        </div>

        <!-- ダッシュボードコンテンツ -->
        <div id="dashboard-content" style="display: none;">
          
          <!-- 在庫サマリーカード -->
          <div class="summary-cards">
            <div class="summary-card card-primary">
              <div class="card-icon">📦</div>
              <div class="card-content">
                <div class="card-label">現在在庫</div>
                <div class="card-value" id="current-qty">-</div>
                <div class="card-unit" id="current-unit">個</div>
              </div>
              <div class="card-badge" id="status-badge"></div>
            </div>

            <div class="summary-card card-warning">
              <div class="card-icon">⚠️</div>
              <div class="card-content">
                <div class="card-label">安全在庫</div>
                <div class="card-value" id="safety-stock">-</div>
                <div class="card-unit" id="safety-unit">個</div>
              </div>
            </div>

            <div class="summary-card card-info">
              <div class="card-icon">💰</div>
              <div class="card-content">
                <div class="card-label">平均単価</div>
                <div class="card-value" id="average-cost">-</div>
                <div class="card-unit">円</div>
              </div>
            </div>

            <div class="summary-card card-success">
              <div class="card-icon">💵</div>
              <div class="card-content">
                <div class="card-label">在庫金額</div>
                <div class="card-value" id="inventory-value">-</div>
                <div class="card-unit">円</div>
              </div>
            </div>
          </div>

          <!-- アラート一覧 -->
          <div id="alert-section" class="alert-section" style="display: none;"></div>

          <!-- 在庫推移グラフ -->
          <div class="chart-container">
            <div class="chart-header">
              <h3 class="chart-title">在庫推移（過去30日〜未来90日）</h3>
              <div class="chart-legend">
                <span class="legend-item"><span class="legend-line line-actual"></span>実績在庫</span>
                <span class="legend-item"><span class="legend-line line-projected"></span>予測在庫</span>
                <span class="legend-item"><span class="legend-line line-safety"></span>安全在庫</span>
              </div>
            </div>
            <div class="chart-wrapper">
              <canvas id="inventory-chart"></canvas>
            </div>
          </div>

          <!-- 入出庫推移グラフ -->
          <div class="chart-container">
            <div class="chart-header">
              <h3 class="chart-title">入出庫推移（過去14日）</h3>
              <div class="chart-legend">
                <span class="legend-item"><span class="legend-box box-received"></span>入庫</span>
                <span class="legend-item"><span class="legend-box box-issued"></span>出庫</span>
              </div>
            </div>
            <div class="chart-wrapper">
              <canvas id="transaction-chart"></canvas>
            </div>
          </div>

          <!-- 取引履歴 -->
          <div class="history-container">
            <div class="history-header">
              <h3 class="history-title">直近の取引履歴</h3>
            </div>
            <div id="transaction-history" class="history-list"></div>
          </div>

        </div>

        <!-- ローディング -->
        <div id="dashboard-loading" class="dashboard-loading" style="display: none;">
          <div class="loading-spinner"></div>
          <div class="loading-text">データを読み込んでいます...</div>
        </div>

        <!-- エラーメッセージ -->
        <div id="error-message" class="error-message" style="display: none;"></div>

      </div>
    `;
  }

  /**
   * 品目一覧を読み込み
   */
  async function loadItemList() {
    try {
      Utils.log('品目一覧を読み込み中...');

      // 在庫残高アプリから品目一覧を取得
      const query = 'order by item_code asc';
      const fields = ['item_code', 'item_name', 'warehouse', 'location'];
      const records = await Utils.getRecords(CONFIG.APP_IDS.INVENTORY_BALANCE, query, fields);

      Utils.log(`品目レコード数: ${records.length}`);

      // 品目別にグループ化
      const itemMap = new Map();
      records.forEach(record => {
        const itemCode = Utils.getFieldValue(record, 'item_code');
        const itemName = Utils.getFieldValue(record, 'item_name');
        
        if (!itemMap.has(itemCode)) {
          itemMap.set(itemCode, {
            code: itemCode,
            name: itemName,
            locations: []
          });
        }

        const warehouse = Utils.getFieldValue(record, 'warehouse');
        const location = Utils.getFieldValue(record, 'location');
        
        itemMap.get(itemCode).locations.push({
          warehouse: warehouse,
          location: location
        });
      });

      // セレクトボックスに追加
      const itemSelect = document.getElementById('item-select');
      itemMap.forEach((item, code) => {
        const option = document.createElement('option');
        option.value = code;
        option.textContent = `${code} - ${item.name}`;
        option.dataset.locations = JSON.stringify(item.locations);
        itemSelect.appendChild(option);
      });

      Utils.log('✅ 品目一覧の読み込み完了');

    } catch (error) {
      Utils.error('品目一覧の読み込みエラー:', error);
      throw error;
    }
  }

  /**
   * イベントリスナーを設定
   */
  function setupEventListeners() {
    // 品目選択
    const itemSelect = document.getElementById('item-select');
    itemSelect.addEventListener('change', onItemChange);

    // 倉庫選択
    const warehouseSelect = document.getElementById('warehouse-select');
    warehouseSelect.addEventListener('change', onWarehouseChange);

    // ロケーション選択
    const locationSelect = document.getElementById('location-select');
    locationSelect.addEventListener('change', onLocationChange);

    // 更新ボタン
    const refreshBtn = document.getElementById('refresh-btn');
    refreshBtn.addEventListener('click', refreshDashboard);
  }

  /**
   * 品目変更イベント
   */
  async function onItemChange(e) {
    const itemCode = e.target.value;

    if (!itemCode) {
      // 品目未選択の場合
      showInitialMessage();
      return;
    }

    // 倉庫・ロケーションの選択肢を更新
    const selectedOption = e.target.options[e.target.selectedIndex];
    const locations = JSON.parse(selectedOption.dataset.locations || '[]');

    updateWarehouseSelect(locations);

    // ダッシュボードを更新
    await loadDashboard(itemCode);
  }

  /**
   * 倉庫変更イベント
   */
  async function onWarehouseChange(e) {
    const itemCode = document.getElementById('item-select').value;
    const warehouse = e.target.value;

    if (!itemCode) return;

    // ロケーション選択肢を更新
    const selectedOption = document.getElementById('item-select').options[document.getElementById('item-select').selectedIndex];
    const locations = JSON.parse(selectedOption.dataset.locations || '[]');
    
    const filteredLocations = warehouse 
      ? locations.filter(loc => loc.warehouse === warehouse)
      : locations;

    updateLocationSelect(filteredLocations);

    // ダッシュボードを更新
    await loadDashboard(itemCode, warehouse);
  }

  /**
   * ロケーション変更イベント
   */
  async function onLocationChange(e) {
    const itemCode = document.getElementById('item-select').value;
    const warehouse = document.getElementById('warehouse-select').value;
    const location = e.target.value;

    if (!itemCode) return;

    // ダッシュボードを更新
    await loadDashboard(itemCode, warehouse, location);
  }

  /**
   * 倉庫セレクトボックスを更新
   */
  function updateWarehouseSelect(locations) {
    const warehouseSelect = document.getElementById('warehouse-select');
    warehouseSelect.innerHTML = '<option value="">すべて</option>';

    // 重複を除去
    const warehouses = [...new Set(locations.map(loc => loc.warehouse))];
    
    warehouses.forEach(warehouse => {
      const option = document.createElement('option');
      option.value = warehouse;
      option.textContent = warehouse;
      warehouseSelect.appendChild(option);
    });

    warehouseSelect.disabled = warehouses.length === 0;
  }

  /**
   * ロケーションセレクトボックスを更新
   */
  function updateLocationSelect(locations) {
    const locationSelect = document.getElementById('location-select');
    locationSelect.innerHTML = '<option value="">すべて</option>';

    // 重複を除去
    const locationCodes = [...new Set(locations.map(loc => loc.location))];
    
    locationCodes.forEach(location => {
      const option = document.createElement('option');
      option.value = location;
      option.textContent = location;
      locationSelect.appendChild(option);
    });

    locationSelect.disabled = locationCodes.length === 0;
  }

  /**
   * ダッシュボードを読み込み
   */
  async function loadDashboard(itemCode, warehouse = '', location = '') {
    try {
      showLoading();

      Utils.log(`ダッシュボード読み込み: ${itemCode} - ${warehouse || 'すべて'} - ${location || 'すべて'}`);

      // 在庫残高を取得
      const balance = await getInventoryBalance(itemCode, warehouse, location);

      // 在庫推移サマリーを取得
      const summaryData = await getInventorySummary(itemCode, warehouse, location);

      // 取引履歴を取得
      const transactions = await getTransactionHistory(itemCode, warehouse, location);

      // サマリーカードを更新
      updateSummaryCards(balance);

      // グラフを更新
      updateInventoryChart(summaryData, balance.safety_stock);
      updateTransactionChart(summaryData);

      // アラートを表示
      updateAlerts(summaryData, balance);

      // 取引履歴を表示
      updateTransactionHistory(transactions);

      // コンテンツを表示
      hideInitialMessage();
      hideLoading();

      Utils.log('✅ ダッシュボード読み込み完了');

    } catch (error) {
      Utils.error('ダッシュボード読み込みエラー:', error);
      hideLoading();
      showError('ダッシュボードの読み込みに失敗しました: ' + error.message);
    }
  }

  /**
   * 在庫残高を取得
   */
  async function getInventoryBalance(itemCode, warehouse, location) {
    let query = `item_code = "${itemCode}"`;
    
    if (warehouse) {
      query += ` and warehouse = "${warehouse}"`;
    }
    if (location) {
      query += ` and location = "${location}"`;
    }

    const records = await Utils.getRecords(CONFIG.APP_IDS.INVENTORY_BALANCE, query);

    if (records.length === 0) {
      throw new Error('在庫残高が見つかりません');
    }

    // 複数ロケーションの場合は合計
    let totalQty = 0;
    let totalValue = 0;
    let avgCost = 0;
    let safetyStock = 0;
    let unit = '';

    records.forEach(record => {
      totalQty += Utils.getNumberValue(record, 'current_qty');
      avgCost = Utils.getNumberValue(record, 'average_cost');
      safetyStock += Utils.getNumberValue(record, 'safety_stock');
      unit = Utils.getFieldValue(record, 'unit');
    });

    totalValue = totalQty * avgCost;

    return {
      current_qty: totalQty,
      average_cost: avgCost,
      inventory_value: totalValue,
      safety_stock: safetyStock,
      unit: unit,
      alert_flag: records[0] ? Utils.getFieldValue(records[0], 'alert_flag') : ''
    };
  }

  /**
   * 在庫推移サマリーを取得
   */
  async function getInventorySummary(itemCode, warehouse, location) {
    const today = new Date();
    const startDate = Utils.addDays(today, -30);
    const endDate = Utils.addDays(today, 90);

    let query = `item_code = "${itemCode}" and ` +
                `summary_date >= "${Utils.formatDate(startDate)}" and ` +
                `summary_date <= "${Utils.formatDate(endDate)}"`;

    if (warehouse) {
      query += ` and warehouse = "${warehouse}"`;
    }
    if (location) {
      query += ` and location = "${location}"`;
    }

    query += ` order by summary_date asc`;

    const records = await Utils.getAllRecords(CONFIG.APP_IDS.INVENTORY_PROJECTION, query);

    Utils.log(`サマリーレコード数: ${records.length}`);

    return records.map(record => ({
      date: Utils.getFieldValue(record, 'summary_date'),
      beginning_qty: Utils.getNumberValue(record, 'beginning_qty'),
      actual_received_qty: Utils.getNumberValue(record, 'actual_received_qty'),
      actual_issued_qty: Utils.getNumberValue(record, 'actual_issued_qty'),
      ending_qty: Utils.getNumberValue(record, 'ending_qty'),
      planned_received_qty: Utils.getNumberValue(record, 'planned_received_qty'),
      planned_issued_qty: Utils.getNumberValue(record, 'planned_issued_qty'),
      projected_ending_qty: Utils.getNumberValue(record, 'projected_ending_qty')
    }));
  }

  /**
   * 取引履歴を取得
   */
  async function getTransactionHistory(itemCode, warehouse, location) {
    let query = `item_code = "${itemCode}"`;
    
    if (warehouse) {
      query += ` and warehouse = "${warehouse}"`;
    }
    if (location) {
      query += ` and location = "${location}"`;
    }

    query += ` order by transaction_date desc, $id desc limit 10`;

    const records = await Utils.getRecords(CONFIG.APP_IDS.INVENTORY_TRANSACTION, query);

    return records.map(record => ({
      transaction_id: Utils.getFieldValue(record, 'transaction_id'),
      transaction_date: Utils.getFieldValue(record, 'transaction_date'),
      transaction_type: Utils.getFieldValue(record, 'transaction_type'),
      status: Utils.getFieldValue(record, 'status'),
      quantity: Utils.getNumberValue(record, 'quantity'),
      unit_cost: Utils.getNumberValue(record, 'unit_cost'),
      remarks: Utils.getFieldValue(record, 'remarks')
    }));
  }

  // 続く...

  /**
   * サマリーカードを更新
   */
  function updateSummaryCards(balance) {
    document.getElementById('current-qty').textContent = balance.current_qty.toLocaleString();
    document.getElementById('current-unit').textContent = balance.unit;
    document.getElementById('safety-stock').textContent = balance.safety_stock.toLocaleString();
    document.getElementById('safety-unit').textContent = balance.unit;
    document.getElementById('average-cost').textContent = balance.average_cost.toLocaleString();
    document.getElementById('inventory-value').textContent = Math.round(balance.inventory_value).toLocaleString();

    // ステータスバッジを更新
    const badge = document.getElementById('status-badge');
    const alertFlag = balance.alert_flag || CONFIG.ALERT_FLAGS.NORMAL;

    badge.className = 'card-badge';
    
    if (alertFlag === CONFIG.ALERT_FLAGS.OUT_OF_STOCK) {
      badge.classList.add('badge-danger');
      badge.textContent = '在庫切れ';
    } else if (alertFlag === CONFIG.ALERT_FLAGS.LOW_STOCK) {
      badge.classList.add('badge-warning');
      badge.textContent = '在庫少';
    } else {
      badge.classList.add('badge-success');
      badge.textContent = '正常';
    }
  }

  // グローバル公開
  window.InventoryDashboard = {
    loadDashboard: loadDashboard,
    VERSION: '1.0'
  };

  console.log('[DASHBOARD] ✅ Dashboard initialized');

})();

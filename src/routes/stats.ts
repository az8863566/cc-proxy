import { queryRecordsByRange, queryModelSummaryByRange } from "../db.js";
import { sendJson } from "../server.js";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Config } from "../config.js";
import type { Provider } from "../providers/base.js";

type RouteHandler = (
  req: IncomingMessage,
  res: ServerResponse,
  config: Config,
  providers: Map<string, Provider>,
) => void | Promise<void>;

export const handleStatsApi: RouteHandler = (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const since = url.searchParams.get("since");
  const until = url.searchParams.get("until");

  if (!since || !until) {
    sendJson(res, 400, { error: "Missing since or until parameter" });
    return;
  }

  const records = queryRecordsByRange(since, until);
  const models = queryModelSummaryByRange(since, until);
  const total = models.reduce(
    (acc, m) => {
      acc.count += m.count;
      acc.input_tokens += m.input_tokens;
      acc.output_tokens += m.output_tokens;
      return acc;
    },
    { count: 0, input_tokens: 0, output_tokens: 0 },
  );

  sendJson(res, 200, {
    since,
    until,
    total,
    models,
    records,
  });
};

function renderPage(): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>模型调用统计 — cc-proxy</title>
<link rel="stylesheet" href="https://unpkg.com/element-plus/dist/index.css">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500&display=swap">
<style>
  :root {
    --bg: #f7f8fc;
    --surface: #ffffff;
    --accent: #5b5fe8;
    --out: #0ea882;
    --text: #1e2040;
    --muted: #727694;
    --border: #eaecf4;
    --radius: 10px;
  }
  body {
    background: var(--bg); color: var(--text); margin: 0;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    padding: 28px 32px;
  }
  #app { max-width: 1200px; margin: 0 auto; }

  .page-header {
    display: flex; align-items: center; justify-content: space-between;
    margin-bottom: 24px;
  }
  .page-header h1 {
    font-size: 20px; font-weight: 600; color: var(--text);
    margin: 0; user-select: none;
  }

  .total-strip {
    display: flex; align-items: center; gap: 20px;
    padding: 14px 20px; margin-bottom: 20px;
    background: var(--surface); border-radius: var(--radius);
    border: 1px solid var(--border);
  }
  .total-strip .stat-item { display: flex; flex-direction: column; }
  .total-strip .stat-num {
    font-family: "JetBrains Mono", monospace;
    font-size: 20px; font-weight: 500; color: var(--text);
    font-variant-numeric: tabular-nums;
  }
  .total-strip .stat-num.accent { color: var(--accent); }
  .total-strip .stat-num.out { color: var(--out); }
  .total-strip .stat-label { font-size: 12px; color: var(--muted); }
  .total-strip .total-divider {
    width: 1px; height: 36px; background: var(--border);
  }

  .stat-card {
    background: var(--surface); border-radius: var(--radius);
    padding: 16px 18px; border: 1px solid var(--border);
    border-left: 3px solid var(--accent); height: 100%;
  }
  .stat-card .card-provider {
    font-size: 11px; font-weight: 600; text-transform: uppercase;
    letter-spacing: 0.6px; margin-bottom: 4px;
  }
  .stat-card .card-model {
    font-family: "JetBrains Mono", monospace;
    font-size: 13px; color: var(--text); margin-bottom: 8px;
    word-break: break-all;
  }
  .stat-card .card-count {
    font-size: 26px; font-weight: 600; color: var(--text);
    font-variant-numeric: tabular-nums; margin-bottom: 8px;
  }
  .stat-card .card-tokens { display: flex; gap: 16px; font-size: 12px; }
  .stat-card .card-tokens .tk-in { color: var(--accent); }
  .stat-card .card-tokens .tk-out { color: var(--out); }
  .stat-card .card-tokens .tk-label { color: var(--muted); font-size: 11px; display: block; }

  .stats-carousel .el-carousel__container { height: 200px !important; }
  .stats-carousel .el-carousel__arrow { display: none !important; }
  .stats-carousel .el-carousel__indicators { position: static; margin-top: 10px; }
  .stats-carousel .el-carousel__indicator .el-carousel__button { background: #ccd0dc; opacity: 1; }
  .stats-carousel .el-carousel__indicator.is-active .el-carousel__button { background: var(--accent); }

  .section-header {
    font-size: 13px; font-weight: 600; color: var(--muted);
    text-transform: uppercase; letter-spacing: 0.5px;
    margin-bottom: 10px; margin-top: 28px;
  }

  .el-table {
    --el-table-border-color: var(--border);
    --el-table-header-bg-color: #fafbfc;
    border-radius: var(--radius); overflow: hidden;
  }
  .el-table th.el-table__cell {
    font-size: 11px; font-weight: 600; color: var(--muted);
    text-transform: uppercase; letter-spacing: 0.5px;
  }
  .el-table .cell { padding: 10px 16px; }
  .el-table .col-tk-in { color: var(--accent) !important; font-variant-numeric: tabular-nums; }
  .el-table .col-tk-out { color: var(--out) !important; font-variant-numeric: tabular-nums; }
  .el-table .col-model { font-family: "JetBrains Mono", monospace !important; }

  .el-pagination {
    justify-content: center; padding: 16px 0;
    --el-pagination-hover-color: var(--accent);
    --el-color-primary: var(--accent);
  }

  .empty-day {
    text-align: center; padding: 64px 16px; color: var(--muted); font-size: 14px;
  }
</style>
</head>
<body>
<div id="app">
  <div class="page-header">
    <h1>模型调用统计</h1>
    <el-date-picker
      v-model="date"
      type="date"
      format="YYYY-MM-DD"
      value-format="YYYY-MM-DD"
      placeholder="选择日期"
      @change="loadData"
    />
  </div>

  <div class="total-strip" v-if="total.count > 0">
    <div class="stat-item">
      <span class="stat-label">调用次数</span>
      <span class="stat-num accent">{{ fmt(total.count) }}</span>
    </div>
    <div class="total-divider"></div>
    <div class="stat-item">
      <span class="stat-label">输入 Tokens</span>
      <span class="stat-num">{{ fmt(total.input_tokens) }}</span>
    </div>
    <div class="total-divider"></div>
    <div class="stat-item">
      <span class="stat-label">输出 Tokens</span>
      <span class="stat-num out">{{ fmt(total.output_tokens) }}</span>
    </div>
  </div>

  <template v-if="carouselSlides.length > 0">
    <el-carousel class="stats-carousel" :interval="0" indicator-position="outside" arrow="never" :loop="false" height="200px">
      <el-carousel-item v-for="(slide, i) in carouselSlides" :key="i">
        <el-row :gutter="14" style="padding: 2px 4px;">
          <el-col :span="8" v-for="m in slide" :key="m.provider + '|' + m.provider_model">
            <div class="stat-card" :style="{ borderLeftColor: providerColor(m.provider) }">
              <div class="card-provider" :style="{ color: providerColor(m.provider) }">
                {{ m.provider }}
              </div>
              <div class="card-model">{{ m.provider_model }}</div>
              <div class="card-count">
                {{ fmt(m.count) }}
                <span style="font-size:14px;font-weight:400;color:var(--muted)">次</span>
              </div>
              <div class="card-tokens">
                <span>
                  <span class="tk-label">输入</span>
                  <span class="tk-in">{{ fmt(m.input_tokens) }}</span>
                </span>
                <span>
                  <span class="tk-label">输出</span>
                  <span class="tk-out">{{ fmt(m.output_tokens) }}</span>
                </span>
              </div>
            </div>
          </el-col>
        </el-row>
      </el-carousel-item>
    </el-carousel>
  </template>

  <div class="empty-day" v-if="!loading && total.count === 0 && !error">当日暂无调用记录</div>
  <div class="empty-day" v-if="error" style="color:#dc2626">{{ error }}</div>

  <div class="section-header" v-if="records.length > 0">调用明细</div>
  <el-table
    v-if="records.length > 0"
    :data="pagedRecords"
    v-loading="loading"
    stripe border
    style="width:100%"
  >
    <el-table-column label="时间" width="180">
      <template #default="scope">{{ fmtTime(scope.row.sent_at) }}</template>
    </el-table-column>
    <el-table-column label="模型" min-width="180">
      <template #default="scope">
        <span class="col-model">{{ scope.row.provider_model }}</span>
      </template>
    </el-table-column>
    <el-table-column label="Provider" width="140">
      <template #default="scope">{{ scope.row.provider }}</template>
    </el-table-column>
    <el-table-column label="输入 Tokens" width="140" align="right">
      <template #default="scope">
        <span class="col-tk-in">{{ fmt(scope.row.input_tokens) }}</span>
      </template>
    </el-table-column>
    <el-table-column label="输出 Tokens" width="140" align="right">
      <template #default="scope">
        <span class="col-tk-out">{{ fmt(scope.row.output_tokens) }}</span>
      </template>
    </el-table-column>
    <template #empty>暂无记录</template>
  </el-table>

  <el-pagination
    v-if="records.length > PAGE_SIZE"
    v-model:current-page="currentPage"
    :page-size="PAGE_SIZE"
    :total="records.length"
    layout="total, prev, pager, next"
    background
  />
</div>

<script src="https://unpkg.com/vue@3/dist/vue.global.prod.js"><\/script>
<script src="https://unpkg.com/element-plus"><\/script>
<script>
(function() {
var _p = function(n) { return String(n).padStart(2, "0"); };

function fmt(n) {
  if (n == null) return "0";
  return Number(n).toLocaleString();
}

function fmtTime(iso) {
  if (!iso) return "-";
  var d = new Date(iso);
  return d.getFullYear() + "-" + _p(d.getMonth()+1) + "-" + _p(d.getDate())
    + " " + _p(d.getHours()) + ":" + _p(d.getMinutes()) + ":" + _p(d.getSeconds());
}

function localDateStr(d) {
  return d.getFullYear() + "-" + _p(d.getMonth()+1) + "-" + _p(d.getDate());
}

function utcRange(localStr) {
  var parts = localStr.split("-");
  var y = Number(parts[0]), m = Number(parts[1])-1, d = Number(parts[2]);
  var start = new Date(Date.UTC(y, m, d));
  var end = new Date(Date.UTC(y, m, d + 1));
  return { since: start.toISOString(), until: end.toISOString() };
}

var PROVIDER_COLORS = {
  deepseek: "#5b5fe8",
  zhipu: "#e8713c",
  opencode_go: "#0ea882"
};
function providerColor(provider) {
  return PROVIDER_COLORS[provider] || "#5b5fe8";
}

var CARDS_PER_PAGE = 3;
var PAGE_SIZE = 50;

var app = Vue.createApp({
  setup: function() {
    var date = Vue.ref(localDateStr(new Date()));
    var loading = Vue.ref(false);
    var error = Vue.ref("");
    var total = Vue.reactive({ count: 0, input_tokens: 0, output_tokens: 0 });
    var records = Vue.ref([]);
    var models = Vue.ref([]);
    var currentPage = Vue.ref(1);

    var carouselSlides = Vue.computed(function() {
      var slides = [];
      for (var i = 0; i < models.value.length; i += CARDS_PER_PAGE) {
        slides.push(models.value.slice(i, i + CARDS_PER_PAGE));
      }
      return slides;
    });

    var pagedRecords = Vue.computed(function() {
      var start = (currentPage.value - 1) * PAGE_SIZE;
      return records.value.slice(start, start + PAGE_SIZE);
    });

    function loadData() {
      loading.value = true;
      error.value = "";
      currentPage.value = 1;
      var range = utcRange(date.value);
      fetch("/api/stats?since=" + encodeURIComponent(range.since) + "&until=" + encodeURIComponent(range.until))
        .then(function(r) { if (!r.ok) throw new Error(r.statusText); return r.json(); })
        .then(function(data) {
          var t = data.total || { count: 0, input_tokens: 0, output_tokens: 0 };
          total.count = t.count;
          total.input_tokens = t.input_tokens;
          total.output_tokens = t.output_tokens;
          models.value = data.models || [];
          records.value = data.records || [];
        })
        .catch(function(err) {
          error.value = "加载失败: " + err.message;
          total.count = 0; total.input_tokens = 0; total.output_tokens = 0;
          models.value = [];
          records.value = [];
        })
        .finally(function() { loading.value = false; });
    }

    Vue.onMounted(function() { loadData(); });

    return {
      date: date, loading: loading, error: error,
      total: total, records: records, models: models,
      currentPage: currentPage, PAGE_SIZE: PAGE_SIZE,
      carouselSlides: carouselSlides, pagedRecords: pagedRecords,
      fmt: fmt, fmtTime: fmtTime, providerColor: providerColor,
      loadData: loadData
    };
  }
});
app.use(ElementPlus);
app.mount("#app");
})();
<\/script>
</body>
</html>`;
}

export const handleStatsPage: RouteHandler = (_req, res) => {
  const html = renderPage();
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(html);
};

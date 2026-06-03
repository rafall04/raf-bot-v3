/**
 * Header Doc
 * Purpose: Mengelola halaman admin rekap tunggakan, termasuk filter periode, render tab operasional/manajerial, dan detail pelanggan.
 * Caller: `views/sb-admin/rekap-tunggakan.php`.
 * Deps: API `/api/arrears/*`, jQuery, Bootstrap.
 * MainFuncs: `loadArrearsReadModel`, `renderOperationalTable`, `renderManagerialSummary`, `openCustomerDetail`.
 * SideEffects: Memuat data read model, mengganti DOM, dan meminta detail customer saat dibutuhkan.
 */
"use strict";

const ARREARS_MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];

function formatBucketLabel(bucket) {
    if (bucket === "1_PERIODE") {
        return "1 Periode";
    }
    if (bucket === "2_PERIODE") {
        return "2 Periode";
    }
    if (bucket === "3_PLUS_PERIODE") {
        return "3+ Periode";
    }
    return "-";
}

function formatPeriodKey(periodKey) {
    const [year, month] = String(periodKey || "").split("-");
    const monthIndex = Number(month) - 1;
    return `${ARREARS_MONTH_LABELS[monthIndex] || month} ${year}`;
}

function formatCurrency(value) {
    return new Intl.NumberFormat("id-ID", {
        style: "currency",
        currency: "IDR",
        maximumFractionDigits: 0
    }).format(Number(value || 0));
}

function getDefaultPeriod() {
    const now = new Date();
    return {
        month: now.getMonth() + 1,
        year: now.getFullYear()
    };
}

function buildSummaryCards(summary) {
    const cards = [
        { label: "Pelanggan Menunggak", value: summary.total_customers_in_arrears || 0 },
        { label: "Total Tunggakan", value: formatCurrency(summary.total_outstanding || 0) },
        { label: "1 Periode", value: summary.bucket_1_period || 0 },
        { label: "2 Periode", value: summary.bucket_2_period || 0 },
        { label: "3+ Periode", value: summary.bucket_3_plus_period || 0 }
    ];

    return cards.map((card) => `
        <div class="col-lg col-md-6 mb-3">
            <div class="card shadow-sm border-0 h-100">
                <div class="card-body">
                    <div class="text-xs text-uppercase text-muted mb-1">${card.label}</div>
                    <div class="h5 mb-0 font-weight-bold text-gray-800">${card.value}</div>
                </div>
            </div>
        </div>
    `).join("");
}

function renderOperationalTable(rows) {
    if (!rows.length) {
        return `<div class="alert alert-light border">Tidak ada pelanggan menunggak pada periode ini.</div>`;
    }

    const body = rows.map((row) => `
        <tr>
            <td>${row.user_id}</td>
            <td>${row.name || "-"}</td>
            <td>${row.phone_number || "-"}</td>
            <td>${row.subscription || "-"}</td>
            <td>${row.area || "-"}</td>
            <td>${row.status || "-"}</td>
            <td>${row.unpaid_period_count || 0}</td>
            <td>${row.oldest_unpaid_period ? formatPeriodKey(row.oldest_unpaid_period) : "-"}</td>
            <td>${formatCurrency(row.current_period_outstanding || 0)}</td>
            <td>${formatCurrency(row.total_outstanding || 0)}</td>
            <td>${formatBucketLabel(row.aging_bucket)}</td>
            <td><button class="btn btn-sm btn-outline-primary js-arrears-detail" data-user-id="${row.user_id}">Detail</button></td>
        </tr>
    `).join("");

    return `
        <div class="card shadow-sm border-0">
            <div class="card-body">
                <div class="table-responsive">
                    <table class="table table-bordered table-hover mb-0">
                        <thead class="thead-light">
                            <tr>
                                <th>ID</th>
                                <th>Nama</th>
                                <th>No. WA</th>
                                <th>Paket</th>
                                <th>Area</th>
                                <th>Status</th>
                                <th>Jml Periode</th>
                                <th>Periode Tertua</th>
                                <th>Tunggakan Periode Acuan</th>
                                <th>Total Tunggakan</th>
                                <th>Bucket</th>
                                <th>Aksi</th>
                            </tr>
                        </thead>
                        <tbody>${body}</tbody>
                    </table>
                </div>
            </div>
        </div>
    `;
}

function renderManagerialSummary(summary, rows) {
    const collectionByCustomer = `${((summary.collection_rate_by_customer || 0) * 100).toFixed(1)}%`;
    const collectionByAmount = `${((summary.collection_rate_by_amount || 0) * 100).toFixed(1)}%`;
    const topRows = rows
        .slice()
        .sort((left, right) => (right.total_outstanding || 0) - (left.total_outstanding || 0))
        .slice(0, 10)
        .map((row) => `
            <tr>
                <td>${row.name || "-"}</td>
                <td>${row.area || "-"}</td>
                <td>${formatCurrency(row.total_outstanding || 0)}</td>
                <td>${formatBucketLabel(row.aging_bucket)}</td>
            </tr>
        `)
        .join("");

    return `
        <div class="row mb-3">
            <div class="col-md-3 mb-3"><div class="card shadow-sm border-0"><div class="card-body"><div class="text-xs text-uppercase text-muted mb-1">Total Pelanggan Menunggak</div><div class="h5 mb-0 font-weight-bold">${summary.total_customers_in_arrears || 0}</div></div></div></div>
            <div class="col-md-3 mb-3"><div class="card shadow-sm border-0"><div class="card-body"><div class="text-xs text-uppercase text-muted mb-1">Total Outstanding</div><div class="h5 mb-0 font-weight-bold">${formatCurrency(summary.total_outstanding || 0)}</div></div></div></div>
            <div class="col-md-3 mb-3"><div class="card shadow-sm border-0"><div class="card-body"><div class="text-xs text-uppercase text-muted mb-1">Collection Rate Customer</div><div class="h5 mb-0 font-weight-bold">${collectionByCustomer}</div></div></div></div>
            <div class="col-md-3 mb-3"><div class="card shadow-sm border-0"><div class="card-body"><div class="text-xs text-uppercase text-muted mb-1">Collection Rate Amount</div><div class="h5 mb-0 font-weight-bold">${collectionByAmount}</div></div></div></div>
        </div>
        <div class="card shadow-sm border-0">
            <div class="card-header bg-white"><strong>Top Outstanding Customer</strong></div>
            <div class="card-body">
                <div class="table-responsive">
                    <table class="table table-bordered table-hover mb-0">
                        <thead class="thead-light">
                            <tr>
                                <th>Nama</th>
                                <th>Area</th>
                                <th>Total Outstanding</th>
                                <th>Bucket</th>
                            </tr>
                        </thead>
                        <tbody>${topRows || '<tr><td colspan="4" class="text-center text-muted">Tidak ada data</td></tr>'}</tbody>
                    </table>
                </div>
            </div>
        </div>
    `;
}

function createArrearsPageController() {
    let currentTab = "operasional";
    let currentData = { rows: [], summary: {} };

    async function loadArrearsReadModel() {
        const periodMonth = $("#periodMonth").val();
        const periodYear = $("#periodYear").val();
        const response = await fetch(`/api/arrears/read-model?period_month=${periodMonth}&period_year=${periodYear}`, {
            credentials: "include"
        });
        const payload = await response.json();
        if (!response.ok || payload.status !== 200) {
            throw new Error(payload.message || "Gagal memuat rekap tunggakan");
        }
        currentData = payload.data || { rows: [], summary: {} };
        render();
    }

    function render() {
        $("#arrearsSummaryRow").html(buildSummaryCards(currentData.summary || {}));
        if (currentTab === "operasional") {
            $("#arrearsTabContent").html(renderOperationalTable(currentData.rows || []));
        } else {
            $("#arrearsTabContent").html(renderManagerialSummary(currentData.summary || {}, currentData.rows || []));
        }
    }

    async function openCustomerDetail(userId) {
        const periodMonth = $("#periodMonth").val();
        const periodYear = $("#periodYear").val();
        const response = await fetch(`/api/arrears/customer/${userId}?period_month=${periodMonth}&period_year=${periodYear}`, {
            credentials: "include"
        });
        const payload = await response.json();
        const customer = payload.data?.customer || null;
        const totalOutstanding = payload.data?.total_outstanding || 0;
        window.alert(customer ? `${customer.name}\nTotal Outstanding: ${formatCurrency(totalOutstanding)}` : "Detail pelanggan tidak ditemukan.");
    }

    function populatePeriodSelectors() {
        const defaults = getDefaultPeriod();
        const monthOptions = ARREARS_MONTH_LABELS.map((label, index) => `<option value="${index + 1}">${label}</option>`).join("");
        const currentYear = defaults.year;
        let yearOptions = "";
        for (let year = currentYear - 2; year <= currentYear + 1; year += 1) {
            yearOptions += `<option value="${year}">${year}</option>`;
        }
        $("#periodMonth").html(monthOptions).val(String(defaults.month));
        $("#periodYear").html(yearOptions).val(String(defaults.year));
    }

    function bindEvents() {
        $("#applyArrearsFilterBtn").on("click", () => {
            loadArrearsReadModel().catch((error) => {
                $("#arrearsTabContent").html(`<div class="alert alert-danger">${error.message}</div>`);
            });
        });

        $("#arrearsTabNav").on("click", "[data-tab]", function onTabClick() {
            currentTab = $(this).data("tab");
            $("#arrearsTabNav .nav-link").removeClass("active");
            $(this).addClass("active");
            render();
        });

        $("#arrearsTabContent").on("click", ".js-arrears-detail", function onDetailClick() {
            openCustomerDetail($(this).data("user-id")).catch((error) => {
                window.alert(error.message);
            });
        });
    }

    return {
        init() {
            populatePeriodSelectors();
            bindEvents();
            return loadArrearsReadModel().catch((error) => {
                $("#arrearsTabContent").html(`<div class="alert alert-danger">${error.message}</div>`);
            });
        }
    };
}

if (typeof window !== "undefined" && window.document && typeof window.$ === "function") {
    window.rekapTunggakanPage = createArrearsPageController();
    window.$(function onReady() {
        window.rekapTunggakanPage.init();
    });
}

if (typeof module !== "undefined" && module.exports) {
    module.exports = {
        formatBucketLabel,
        formatPeriodKey,
        formatCurrency
    };
}

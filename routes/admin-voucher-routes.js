/**
 * Header Doc
 * Purpose: Registrar route admin untuk voucher profile dan agent voucher.
 * Caller: `routes/admin-router.js`.
 * Deps: Router Express, middleware auth staf, manager voucher/agent, helper render/send, dan runtime repository voucher.
 * MainFuncs: `registerAdminVoucherRoutes`.
 * SideEffects: Menulis voucher profile ke persistence lama dan mengirim voucher via WhatsApp bila diminta.
 */
"use strict";

const { asyncHandler } = require("../lib/error-handler");

function registerAdminVoucherRoutes(router, deps) {
    const {
        ensureAuthenticatedStaff,
        runtime,
        loadJSON,
        agentVoucherManager,
        agentManager,
        renderTemplate,
        appendVoucherSentHistory,
        buildVoucherSentHistoryEntries,
        getVoucherProfileById,
        buildVoucherProfileSnapshot,
        sendVoucherTextToPhones
    } = deps;

    function syncVoucherRuntime() {
        const latestVoucher = loadJSON("voucher.json");
        runtime.repositories.voucher ? runtime.repositories.voucher.setAll(latestVoucher) : runtime.state.set("voucher", latestVoucher);
        return latestVoucher;
    }

    router.get("/api/voucher", ensureAuthenticatedStaff, (_req, res) => {
        try {
            const voucherManager = require("../lib/voucher-manager");
            const vouchers = voucherManager.getVoucherProfiles();
            if (!Array.isArray(vouchers) || vouchers.length === 0) return res.json([]);
            const vouchersWithReseller = vouchers.map((voucher) => {
                const hargaJual = parseInt(voucher.hargavc || 0);
                const hargaReseller = parseInt(voucher.hargaReseller || 0);
                const margin = hargaJual - hargaReseller;
                return {
                    prof: voucher.prof || "",
                    namavc: voucher.namavc || "",
                    durasivc: voucher.durasivc || "",
                    hargavc: voucher.hargavc || "0",
                    hargaReseller: voucher.hargaReseller || (hargaReseller > 0 ? String(hargaReseller) : null),
                    margin: voucher.margin || (hargaReseller > 0 ? String(margin) : null)
                };
            });
            res.json(vouchersWithReseller);
        } catch (error) {
            console.error("[VOUCHER_API] Error getting vouchers:", error);
            res.status(500).json({ error: "Failed to get vouchers", message: error.message });
        }
    });

    router.post("/api/voucher", ensureAuthenticatedStaff, asyncHandler(async (req, res) => {
        try {
            const voucherManager = require("../lib/voucher-manager");
            const { prof, namavc, durasivc, hargavc, hargaReseller } = req.body;
            if (!prof || !namavc || !durasivc || !hargavc) return res.status(400).json({ error: "Missing required fields" });
            const hargaJual = parseInt(hargavc);
            const hargaResellerValue = hargaReseller ? parseInt(hargaReseller) : null;
            const margin = hargaResellerValue ? hargaJual - hargaResellerValue : null;
            const result = voucherManager.addVoucherProfile({
                prof, namavc, durasivc,
                hargavc: String(hargaJual),
                hargaReseller: hargaResellerValue ? String(hargaResellerValue) : null,
                margin: margin ? String(margin) : null
            });
            if (!result.success) return res.status(400).json({ error: result.message });
            syncVoucherRuntime();
            res.json({ success: true, message: "Voucher created successfully" });
        } catch (error) {
            console.error("[VOUCHER_API] Error creating voucher:", error);
            res.status(500).json({ error: "Failed to create voucher" });
        }
    }));

    router.put("/api/voucher/:id", ensureAuthenticatedStaff, asyncHandler(async (req, res) => {
        try {
            const voucherManager = require("../lib/voucher-manager");
            const { id } = req.params;
            const { prof, namavc, durasivc, hargavc, hargaReseller } = req.body;
            if (!namavc || !durasivc || !hargavc) return res.status(400).json({ error: "Missing required fields" });
            const hargaJual = parseInt(hargavc);
            const hargaResellerValue = hargaReseller ? parseInt(hargaReseller) : null;
            const margin = hargaResellerValue ? hargaJual - hargaResellerValue : null;
            const result = voucherManager.updateVoucherProfile(id, {
                prof: prof || id,
                namavc,
                durasivc,
                hargavc: String(hargaJual),
                hargaReseller: hargaResellerValue ? String(hargaResellerValue) : null,
                margin: margin ? String(margin) : null
            });
            if (!result.success) return res.status(400).json({ error: result.message });
            syncVoucherRuntime();
            res.json({ success: true, message: "Voucher updated successfully" });
        } catch (error) {
            console.error("[VOUCHER_API] Error updating voucher:", error);
            res.status(500).json({ error: "Failed to update voucher" });
        }
    }));

    router.delete("/api/voucher/:id", ensureAuthenticatedStaff, asyncHandler(async (req, res) => {
        try {
            const voucherManager = require("../lib/voucher-manager");
            const result = voucherManager.deleteVoucherProfile(req.params.id);
            if (!result.success) return res.status(400).json({ error: result.message });
            syncVoucherRuntime();
            res.json({ success: true, message: "Voucher deleted successfully" });
        } catch (error) {
            console.error("[VOUCHER_API] Error deleting voucher:", error);
            res.status(500).json({ error: "Failed to delete voucher" });
        }
    }));

    router.get("/api/admin/agent-voucher/stats", ensureAuthenticatedStaff, (_req, res) => {
        try {
            const agents = agentManager.getAllAgents();
            let totalPurchases = 0;
            let totalSales = 0;
            let totalRevenue = 0;
            let totalProfit = 0;
            let totalStok = 0;
            const agentStats = [];
            agents.forEach((agent) => {
                const inventory = agentVoucherManager.getAgentInventory(agent.id);
                const stats = agentVoucherManager.getAgentVoucherStats(agent.id);
                totalStok += inventory.totalStok;
                totalPurchases += stats.purchases.total;
                totalSales += stats.sales.total;
                totalRevenue += stats.sales.totalAmount;
                totalProfit += stats.sales.totalProfit;
                if (stats.sales.total > 0 || stats.purchases.total > 0) {
                    agentStats.push({ agentId: agent.id, agentName: agent.name, totalStok: inventory.totalStok, totalPurchases: stats.purchases.total, totalSales: stats.sales.total, totalRevenue: stats.sales.totalAmount, totalProfit: stats.sales.totalProfit });
                }
            });
            agentStats.sort((a, b) => b.totalProfit - a.totalProfit);
            res.json({ status: 200, message: "Statistics retrieved successfully", data: { overall: { totalAgents: agentStats.length, totalStok, totalPurchases, totalSales, totalRevenue, totalProfit }, topAgents: agentStats.slice(0, 10) } });
        } catch (error) {
            console.error("[AGENT_VOUCHER_STATS] Error:", error);
            res.status(500).json({ status: 500, message: "Error retrieving statistics: " + error.message, data: null });
        }
    });

    router.get("/api/admin/agent-voucher/agents", ensureAuthenticatedStaff, (_req, res) => {
        try {
            const agents = agentManager.getAllAgents().map((agent) => ({ id: agent.id, name: agent.name, phone: agent.phone, area: agent.area }));
            res.json({ status: 200, message: "Agents retrieved successfully", data: agents });
        } catch (error) {
            console.error("[AGENT_VOUCHER_AGENTS] Error:", error);
            res.status(500).json({ status: 500, message: "Error retrieving agents: " + error.message, data: null });
        }
    });

    router.post("/api/admin/agent-voucher/purchase", ensureAuthenticatedStaff, asyncHandler(async (req, res) => {
        try {
            const { agentId, voucherProfileId, quantity, paymentMethod, sendWhatsApp, notes, voucherType } = req.body;
            if (!agentId || !voucherProfileId || !quantity) return res.status(400).json({ status: 400, message: "agentId, voucherProfileId, dan quantity wajib diisi" });
            if (voucherType === "custom") return res.status(400).json({ status: 400, message: "Custom voucher tidak didukung untuk pembelian reseller" });
            const profile = getVoucherProfileById(voucherProfileId);
            if (!profile) return res.status(404).json({ status: 404, message: "Voucher profile tidak ditemukan" });
            if (profile.hargaReseller === undefined || profile.hargaReseller === null || String(profile.hargaReseller).trim() === "") return res.status(400).json({ status: 400, message: "Voucher profile belum memiliki harga reseller" });
            const agent = agentManager.getAgentById(agentId);
            if (!agent) return res.status(404).json({ status: 404, message: "Agent tidak ditemukan" });
            const result = await agentVoucherManager.purchaseVoucherAsReseller(agentId, voucherProfileId, quantity, paymentMethod || "saldo", agent.name);
            if (!result.success) return res.status(400).json({ status: 400, message: result.message });
            let delivery = { requestedPhones: [], sentTo: [], failedTo: [] };
            if (sendWhatsApp && agent.phone) {
                const appConfig = runtime && typeof runtime.getConfig === "function" ? runtime.getConfig() : {};
                const voucherList = (result.purchase?.voucherCodes || []).map((item, index) => `${index + 1}. Kode: \`${item.username}\``).join("\n");
                const message = renderTemplate("voucher_send", { nama_paket: profile.namavc || profile.prof, durasi: profile.durasivc || "-", voucher_list: voucherList, catatan: notes ? `Catatan: ${notes}` : "", nama_wifi: appConfig?.nama_wifi || "RAF NET" });
                delivery = await sendVoucherTextToPhones(message, [agent.phone]);
                appendVoucherSentHistory(buildVoucherSentHistoryEntries({
                    batchId: `VSB_${Date.now()}`,
                    vouchers: (result.purchase?.voucherCodes || []).map((code) => ({ username: code.username, password: code.password, profile: profile.prof, type: "random" })),
                    profile: profile.prof,
                    profileName: profile.namavc,
                    duration: profile.durasivc,
                    notes: notes || null,
                    requestedPhones: delivery.requestedPhones,
                    sentTo: delivery.sentTo,
                    failedTo: delivery.failedTo,
                    createdBy: req.user?.username || "admin",
                    sentStatus: delivery.sentTo.length === delivery.requestedPhones.length ? "sent" : (delivery.sentTo.length > 0 ? "partial_sent" : "failed"),
                    metadata: { transaction_context: "agent_purchase", recipient_type: "agent_reseller", voucher_source: "agent_inventory", price_snapshot: parseInt(profile.hargaReseller || 0), price_type: "reseller", voucher_profile_snapshot: buildVoucherProfileSnapshot(profile), agent_id: agentId, financial_effect: "purchase_recorded", reference_id: result.purchase?.id || null }
                }));
            }
            res.json({ status: 200, message: result.message, data: { purchase: result.purchase, inventory: result.inventory, delivery: { requested: delivery.requestedPhones.length, sent: delivery.sentTo.length, sent_to: delivery.sentTo, failed_to: delivery.failedTo } } });
        } catch (error) {
            console.error("[AGENT_VOUCHER_PURCHASE] Error:", error);
            res.status(500).json({ status: 500, message: "Error creating agent purchase: " + error.message });
        }
    }));

    router.post("/api/admin/agent-voucher/sale", ensureAuthenticatedStaff, asyncHandler(async (req, res) => {
        try {
            const { agentId, customerId, customerName, voucherProfileId, quantity, paymentMethod, sendWhatsApp, notes, voucherType } = req.body;
            if (!agentId || !customerId || !voucherProfileId) return res.status(400).json({ status: 400, message: "agentId, customerId, dan voucherProfileId wajib diisi" });
            if (voucherType === "custom") return res.status(400).json({ status: 400, message: "Custom voucher tidak didukung untuk penjualan inventory agent" });
            const profile = getVoucherProfileById(voucherProfileId);
            if (!profile) return res.status(404).json({ status: 404, message: "Voucher profile tidak ditemukan" });
            const result = await agentVoucherManager.sellVoucherToCustomer(agentId, customerId, voucherProfileId, paymentMethod || "cash", customerName || "Customer", null, quantity || 1);
            if (!result.success) return res.status(400).json({ status: 400, message: result.message });

            let delivery = { requestedPhones: [], sentTo: [], failedTo: [] };
            if (sendWhatsApp) {
                const appConfig = runtime && typeof runtime.getConfig === "function" ? runtime.getConfig() : {};
                const voucherList = (result.voucherCodes || []).map((item, index) => `${index + 1}. Kode: \`${item.username}\``).join("\n");
                const message = renderTemplate("voucher_send", {
                    nama_paket: profile.namavc || profile.prof,
                    durasi: profile.durasivc || "-",
                    voucher_list: voucherList,
                    catatan: notes ? `Catatan: ${notes}` : "",
                    nama_wifi: appConfig?.nama_wifi || "RAF NET"
                });

                delivery = await sendVoucherTextToPhones(message, [customerId]);
                appendVoucherSentHistory(buildVoucherSentHistoryEntries({
                    batchId: `VSB_${Date.now()}`,
                    vouchers: (result.voucherCodes || []).map((code) => ({
                        username: code.username,
                        password: code.password,
                        profile: profile.prof,
                        type: "random"
                    })),
                    profile: profile.prof,
                    profileName: profile.namavc,
                    duration: profile.durasivc,
                    notes: notes || null,
                    requestedPhones: delivery.requestedPhones,
                    sentTo: delivery.sentTo,
                    failedTo: delivery.failedTo,
                    createdBy: req.user?.username || "admin",
                    sentStatus: delivery.sentTo.length === delivery.requestedPhones.length ? "sent" : (delivery.sentTo.length > 0 ? "partial_sent" : "failed"),
                    metadata: {
                        transaction_context: "agent_customer_sale",
                        recipient_type: "end_user",
                        voucher_source: "agent_inventory",
                        price_snapshot: parseInt(profile.hargavc || 0),
                        price_type: "retail",
                        voucher_profile_snapshot: buildVoucherProfileSnapshot(profile),
                        agent_id: agentId,
                        customer_id: customerId,
                        financial_effect: "sale_recorded",
                        reference_id: result.sales?.[0]?.id || result.sale?.id || null
                    }
                }));
            }

            res.json({
                status: 200,
                message: result.message,
                data: {
                    sale: result.sale,
                    sales: result.sales,
                    quantity: result.quantity,
                    totalAmount: result.totalAmount,
                    totalProfit: result.totalProfit,
                    inventory: result.inventory,
                    delivery: {
                        requested: delivery.requestedPhones.length,
                        sent: delivery.sentTo.length,
                        sent_to: delivery.sentTo,
                        failed_to: delivery.failedTo
                    }
                }
            });
        } catch (error) {
            console.error("[AGENT_VOUCHER_SALE] Error:", error);
            res.status(500).json({ status: 500, message: "Error creating agent sale: " + error.message });
        }
    }));

    router.get("/api/admin/agent-voucher/inventory", ensureAuthenticatedStaff, (_req, res) => {
        try {
            const inventories = agentManager.getAllAgents().map((agent) => ({ agentId: agent.id, agentName: agent.name, agentPhone: agent.phone, agentArea: agent.area, inventory: agentVoucherManager.getAgentInventory(agent.id) })).filter((item) => item.inventory.totalStok > 0 || item.inventory.totalTerjual > 0);
            res.json({ status: 200, message: "Inventories retrieved successfully", data: inventories });
        } catch (error) {
            console.error("[AGENT_VOUCHER_INVENTORY] Error:", error);
            res.status(500).json({ status: 500, message: "Error retrieving inventories: " + error.message, data: null });
        }
    });

    router.get("/api/admin/agent-voucher/agent/:id/inventory", ensureAuthenticatedStaff, (req, res) => {
        try {
            const agentId = req.params.id;
            const agent = agentManager.getAgentById(agentId);
            if (!agent) return res.status(404).json({ status: 404, message: "Agent not found", data: null });
            const inventory = agentVoucherManager.getAgentInventory(agentId);
            const stats = agentVoucherManager.getAgentVoucherStats(agentId);
            res.json({ status: 200, message: "Inventory retrieved successfully", data: { agent: { id: agent.id, name: agent.name, phone: agent.phone, area: agent.area }, inventory, stats } });
        } catch (error) {
            console.error("[AGENT_VOUCHER_AGENT_INVENTORY] Error:", error);
            res.status(500).json({ status: 500, message: "Error retrieving inventory: " + error.message, data: null });
        }
    });

    router.get("/api/admin/agent-voucher/agent/:id/purchases", ensureAuthenticatedStaff, (req, res) => {
        try {
            const agentId = req.params.id;
            const limit = parseInt(req.query.limit) || 50;
            const agent = agentManager.getAgentById(agentId);
            if (!agent) return res.status(404).json({ status: 404, message: "Agent not found", data: null });
            const purchases = agentVoucherManager.getPurchaseHistory(agentId, limit);
            res.json({ status: 200, message: "Purchase history retrieved successfully", data: { agent: { id: agent.id, name: agent.name }, purchases } });
        } catch (error) {
            console.error("[AGENT_VOUCHER_AGENT_PURCHASES] Error:", error);
            res.status(500).json({ status: 500, message: "Error retrieving purchase history: " + error.message, data: null });
        }
    });

    router.get("/api/admin/agent-voucher/agent/:id/sales", ensureAuthenticatedStaff, (req, res) => {
        try {
            const agentId = req.params.id;
            const limit = parseInt(req.query.limit) || 50;
            const agent = agentManager.getAgentById(agentId);
            if (!agent) return res.status(404).json({ status: 404, message: "Agent not found", data: null });
            const sales = agentVoucherManager.getSalesHistory(agentId, limit);
            res.json({ status: 200, message: "Sales history retrieved successfully", data: { agent: { id: agent.id, name: agent.name }, sales } });
        } catch (error) {
            console.error("[AGENT_VOUCHER_AGENT_SALES] Error:", error);
            res.status(500).json({ status: 500, message: "Error retrieving sales history: " + error.message, data: null });
        }
    });

    router.get("/api/admin/agent-voucher/top-agents", ensureAuthenticatedStaff, (req, res) => {
        try {
            const sortBy = req.query.sortBy || "profit";
            const limit = parseInt(req.query.limit) || 10;
            const agents = agentManager.getAllAgents();
            const agentStats = agents.map((agent) => {
                const stats = agentVoucherManager.getAgentVoucherStats(agent.id);
                return {
                    agentId: agent.id,
                    agentName: agent.name,
                    agentArea: agent.area,
                    totalStok: stats.inventory.totalStok,
                    totalPurchases: stats.purchases.total,
                    totalSales: stats.sales.total,
                    totalRevenue: stats.sales.totalAmount,
                    totalProfit: stats.sales.totalProfit
                };
            }).filter((stat) => stat.totalSales > 0 || stat.totalPurchases > 0);

            if (sortBy === "profit") {
                agentStats.sort((a, b) => b.totalProfit - a.totalProfit);
            } else {
                agentStats.sort((a, b) => b.totalSales - a.totalSales);
            }

            res.json({ status: 200, message: "Top agents retrieved successfully", data: { sortBy, agents: agentStats.slice(0, limit) } });
        } catch (error) {
            console.error("[AGENT_VOUCHER_TOP_AGENTS] Error:", error);
            res.status(500).json({ status: 500, message: "Error retrieving top agents: " + error.message, data: null });
        }
    });
}

module.exports = {
    registerAdminVoucherRoutes
};

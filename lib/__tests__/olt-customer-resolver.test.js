const { createCustomerResolver } = require("../olt-customer-resolver");

// matchMAC asli: bandingkan 10 hex pertama (tangani offset 2 digit terakhir OLT vs MikroTik).
const realMatchMAC = require("../olt-hioso").matchMAC;

function makeResolver({ cache = {}, users = [] } = {}) {
    return createCustomerResolver({
        loadCallerIdCache: () => cache,
        getUsers: () => users,
        matchMAC: realMatchMAC,
    });
}

describe("olt-customer-resolver", () => {
    const users = [
        { id: 1, name: "Budi", pppoe_username: "budi@isp", phone_number: "08123", alamat: "Jl. Melati" },
        { id: 2, name: "Sari", pppoe_username: "sari@isp", phone_number: "08999" },
    ];

    test("resolve MAC persis → customer", () => {
        const resolve = makeResolver({ cache: { "budi@isp": { mac: "1C:E6:39:57:03:21" } }, users });
        expect(resolve("1C:E6:39:57:03:21").name).toBe("Budi");
    });

    test("resolve walau 2 digit terakhir beda (offset OLT vs MikroTik)", () => {
        const resolve = makeResolver({ cache: { "budi@isp": { mac: "1C:E6:39:57:03:21" } }, users });
        expect(resolve("1C:E6:39:57:03:FF").name).toBe("Budi"); // 10 hex pertama sama
    });

    test("MAC tak ada di cache → null", () => {
        const resolve = makeResolver({ cache: { "budi@isp": { mac: "1C:E6:39:57:03:21" } }, users });
        expect(resolve("AA:BB:CC:DD:EE:FF")).toBeNull();
    });

    test("MAC cocok tapi user tidak ada di global.users → null", () => {
        const resolve = makeResolver({ cache: { "ghost@isp": { mac: "1C:E6:39:57:03:21" } }, users });
        expect(resolve("1C:E6:39:57:03:21")).toBeNull();
    });

    test("cache kosong / users kosong → null (tidak crash)", () => {
        expect(makeResolver({ cache: {}, users }).resolve === undefined); // sanity
        expect(makeResolver({ cache: {}, users })("1C:E6:39:57:03:21")).toBeNull();
        expect(makeResolver({ cache: { "budi@isp": { mac: "1C:E6:39:57:03:21" } }, users: [] })("1C:E6:39:57:03:21")).toBeNull();
    });

    test("entri cache tanpa mac di-skip, tidak crash", () => {
        const resolve = makeResolver({ cache: { "budi@isp": {}, "sari@isp": { mac: "AA:BB:CC:DD:EE:01" } }, users });
        expect(resolve("AA:BB:CC:DD:EE:99").name).toBe("Sari");
    });

    test("mac argumen kosong → null", () => {
        const resolve = makeResolver({ cache: { "budi@isp": { mac: "1C:E6:39:57:03:21" } }, users });
        expect(resolve("")).toBeNull();
        expect(resolve(null)).toBeNull();
    });

    test("loadCache yang throw ditangani (best-effort → null)", () => {
        const resolve = createCustomerResolver({
            loadCallerIdCache: () => { throw new Error("fs boom"); },
            getUsers: () => users,
            matchMAC: realMatchMAC,
        });
        expect(resolve("1C:E6:39:57:03:21")).toBeNull();
    });
});

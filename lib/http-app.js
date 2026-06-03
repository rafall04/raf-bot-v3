/**
 * Header Doc
 * Purpose: Membuat instance Express yang sudah ditandai dengan runtime aplikasi untuk bootstrap HTTP yang lebih tipis.
 * Caller: `index.js` sebagai pembuat aplikasi HTTP.
 * Deps: Factory Express yang dipasok caller.
 * MainFuncs: `createHttpApp`.
 * SideEffects: Menyimpan runtime pada `app.locals.runtime`.
 */
"use strict";

function createHttpApp(runtime, expressFactory) {
    const app = expressFactory();
    app.locals.runtime = runtime;
    return app;
}

module.exports = {
    createHttpApp
};

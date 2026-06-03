function nowMs() {
    return Date.now();
}

async function executePsbOperation(operation, handler) {
    const startedAt = nowMs();

    try {
        const data = await handler();
        return {
            ok: true,
            message: data?.message || null,
            errorCode: null,
            timingMs: nowMs() - startedAt,
            data: data?.data !== undefined ? data.data : data
        };
    } catch (error) {
        return {
            ok: false,
            message: error?.message || `PSB operation failed: ${operation}`,
            errorCode: error?.errorCode || error?.code || 'PSB_OPERATION_ERROR',
            timingMs: nowMs() - startedAt,
            data: null,
            error
        };
    }
}

module.exports = {
    executePsbOperation
};

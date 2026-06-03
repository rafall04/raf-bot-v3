jest.mock('../templating', () => ({
    renderTemplate: jest.fn((_key, data) => `OTP:${data.otp}`)
}));

describe('lib/services/public-auth-service', () => {
    let dbRows;

    beforeEach(() => {
        jest.resetModules();
        dbRows = [
            { id: 1, username: 'budi', name: 'Budi', phone_number: '08123|628777', otp: null, otpTimestamp: null, password: 'hashed' },
            { id: 2, username: 'siti', name: 'Siti', phone_number: '08999', otp: null, otpTimestamp: null, password: 'hashed' }
        ];
        global.users = JSON.parse(JSON.stringify(dbRows));
        global.config = { jwt: 'secret' };
        global.db = {
            get: jest.fn((sql, params, cb) => {
                const row = sql.includes('username')
                    ? dbRows.find((item) => item.username === params[0])
                    : null;
                cb(null, row || null);
            }),
            all: jest.fn((_sql, _params, cb) => cb(null, dbRows)),
            run: jest.fn((_sql, params, cb) => {
                const user = dbRows.find((item) => item.id === params[2]);
                if (user) {
                    user.otp = params[0];
                    user.otpTimestamp = params[1];
                }
                cb.call({ changes: 1 }, null);
            })
        };
        global.whatsappConnectionState = 'open';
        global.raf = {
            sendMessage: jest.fn(async () => ({ key: { id: '1' } }))
        };
    });

    test('findUserByNormalizedPhone matches pipe-separated phone numbers', async () => {
        const { PublicAuthService } = require('../services/public-auth-service');
        const user = await PublicAuthService.findUserByNormalizedPhone('628123');

        expect(user).toBeTruthy();
        expect(user.username).toBe('budi');
    });

    test('saveOtp updates cache and sends OTP via delivery helper', async () => {
        const { PublicAuthService } = require('../services/public-auth-service');
        const user = await PublicAuthService.findUserByNormalizedPhone('08123');
        await PublicAuthService.saveOtp(user, '123456');
        const result = await PublicAuthService.sendOtp('08123', '123456');

        expect(result.sent).toBe(true);
        expect(global.users.find((item) => item.id === 1).otp).toBe('123456');
        expect(global.raf.sendMessage).toHaveBeenCalled();
    });
});

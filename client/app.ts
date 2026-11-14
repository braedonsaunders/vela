import { createAnswer } from './src/sources';

const API = import.meta.env.API_BASE_URL ?? 'http://127.0.0.1:7777';
const MOCK_SETTING = import.meta.env.VELA_MOCK ?? '0';
const MOCK = String(MOCK_SETTING) === '1';
export const grants = `net.fetch ${API}\nsecret.keep vela.session\nsecret.keep vela.counter`;
export const answer = createAnswer(API, MOCK);

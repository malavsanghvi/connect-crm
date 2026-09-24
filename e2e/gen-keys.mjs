import crypto from "node:crypto";
const secret = "local-e2e-jwt-secret-with-at-least-32-characters";
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const sign = (p) => { const h = b64({ alg: "HS256", typ: "JWT" }), b = b64(p); return `${h}.${b}.${crypto.createHmac("sha256", secret).update(`${h}.${b}`).digest("base64url")}`; };
const exp = Math.floor(Date.now() / 1000) + 10 * 365 * 86400;
console.log(`JWT_SECRET=${secret}\nANON_KEY=${sign({ role: "anon", iss: "supabase", exp })}\nSERVICE_KEY=${sign({ role: "service_role", iss: "supabase", exp })}`);

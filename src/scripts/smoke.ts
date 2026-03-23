export {};

const baseUrl = (Bun.env.BASE_URL || `http://localhost:${Bun.env.PORT || 8787}`).replace(/\/$/, "");
const ownerEmail = Bun.env.SEED_OWNER_EMAIL || "owner@kasirgo.test";
const ownerPassword = Bun.env.SEED_OWNER_PASSWORD || "12345678";

const assertOk = (condition: unknown, message: string) => {
  if (!condition) {
    throw new Error(message);
  }
};

const main = async () => {
  const healthRes = await fetch(`${baseUrl}/health`);
  assertOk(healthRes.ok, `health failed: ${healthRes.status}`);
  const health = await healthRes.json();
  assertOk(health?.ok === true, "health response invalid");

  const registerRandom = Math.random().toString(16).slice(2, 10);
  const registerEmail = `owner_${registerRandom}@kasirgo.test`;
  const registerPassword = "12345678";
  const registerRes = await fetch(`${baseUrl}/v1/auth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      tenantName: `Tenant ${registerRandom}`,
      ownerName: "Owner Test",
      email: registerEmail,
      password: registerPassword,
      deviceId: "smoke-test-register",
    }),
  });
  assertOk(registerRes.ok, `register failed: ${registerRes.status}`);
  const register = await registerRes.json();
  assertOk(typeof register?.accessToken === "string", "register accessToken missing");

  const loginRes = await fetch(`${baseUrl}/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: ownerEmail, password: ownerPassword, deviceId: "smoke-test" }),
  });
  assertOk(loginRes.ok, `login failed: ${loginRes.status}`);
  const login = await loginRes.json();
  assertOk(typeof login?.accessToken === "string", "login accessToken missing");
  assertOk(typeof login?.refreshToken === "string", "login refreshToken missing");

  const token = login.accessToken as string;
  const refreshToken = login.refreshToken as string;

  const random = Math.random().toString(16).slice(2, 10);

  const meRes = await fetch(`${baseUrl}/v1/me`, {
    headers: { authorization: `Bearer ${token}` },
  });
  assertOk(meRes.ok, `GET /v1/me failed: ${meRes.status}`);
  const me = await meRes.json();
  assertOk(me?.user?.email === ownerEmail, "me email mismatch");

  const meUsersRes = await fetch(`${baseUrl}/v1/users`, {
    headers: { authorization: `Bearer ${token}` },
  });
  assertOk(meUsersRes.ok, `GET /v1/users failed: ${meUsersRes.status}`);

  const categoryName = `Minuman ${random}`;
  const createCatRes = await fetch(`${baseUrl}/v1/categories`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ name: categoryName, isVisible: true, icon: "pricetag", priority: 1 }),
  });
  assertOk(createCatRes.ok, `POST /v1/categories failed: ${createCatRes.status}`);
  const createdCat = await createCatRes.json();
  const categoryId = createdCat?.category?.id as string;
  assertOk(typeof categoryId === "string", "created category id missing");

  const createProdRes = await fetch(`${baseUrl}/v1/products`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({
      name: `Teh Manis ${random}`,
      price: 5000,
      categoryId,
      stock: 10,
      minStock: 2,
      unit: "pcs",
      barcode: `BR-${random}`,
    }),
  });
  assertOk(createProdRes.ok, `POST /v1/products failed: ${createProdRes.status}`);
  const createdProd = await createProdRes.json();
  assertOk(typeof createdProd?.product?.id === "string", "created product id missing");

  const newUserEmail = `cashier_${random}@kasirgo.test`;
  const newUserPin = "123456";

  const createRes = await fetch(`${baseUrl}/v1/users`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({
      email: newUserEmail,
      name: "Kasir Test",
      role: "cashier",
      pin: newUserPin,
    }),
  });
  assertOk(createRes.ok, `POST /v1/users failed: ${createRes.status}`);
  const created = await createRes.json();
  assertOk(created?.user?.email === newUserEmail, "created user mismatch");

  const cashierLoginRes = await fetch(`${baseUrl}/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: newUserEmail, pin: newUserPin, deviceId: "smoke-test-cashier" }),
  });
  assertOk(cashierLoginRes.ok, `cashier login failed: ${cashierLoginRes.status}`);
  const cashierLogin = await cashierLoginRes.json();
  assertOk(typeof cashierLogin?.accessToken === "string", "cashier accessToken missing");
  assertOk(cashierLogin?.user?.role === "cashier", "cashier role mismatch");

  const cashierCatListRes = await fetch(`${baseUrl}/v1/categories`, {
    headers: { authorization: `Bearer ${cashierLogin.accessToken}` },
  });
  assertOk(cashierCatListRes.ok, `cashier GET /v1/categories failed: ${cashierCatListRes.status}`);

  const cashierProdListRes = await fetch(`${baseUrl}/v1/products`, {
    headers: { authorization: `Bearer ${cashierLogin.accessToken}` },
  });
  assertOk(cashierProdListRes.ok, `cashier GET /v1/products failed: ${cashierProdListRes.status}`);

  const cashierUsersRes = await fetch(`${baseUrl}/v1/users`, {
    headers: { authorization: `Bearer ${cashierLogin.accessToken}` },
  });
  assertOk(cashierUsersRes.status === 403, `cashier should be forbidden for /v1/users, got ${cashierUsersRes.status}`);

  const cashierLogoutRes = await fetch(`${baseUrl}/v1/auth/logout`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ refreshToken: cashierLogin.refreshToken }),
  });
  assertOk(cashierLogoutRes.ok, `cashier logout failed: ${cashierLogoutRes.status}`);

  const requestResetRes = await fetch(`${baseUrl}/v1/auth/request-password-reset`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: registerEmail }),
  });
  assertOk(requestResetRes.ok, `request reset failed: ${requestResetRes.status}`);
  const requestReset = await requestResetRes.json();
  assertOk(typeof requestReset?.resetToken === "string", "resetToken missing (set RETURN_RESET_TOKEN=true)");

  const resetRes = await fetch(`${baseUrl}/v1/auth/reset-password`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: requestReset.resetToken, newPassword: "87654321" }),
  });
  assertOk(resetRes.ok, `reset password failed: ${resetRes.status}`);

  const reloginRes = await fetch(`${baseUrl}/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: registerEmail, password: "87654321", deviceId: "smoke-test-relogin" }),
  });
  assertOk(reloginRes.ok, `relogin after reset failed: ${reloginRes.status}`);

  const refreshRes = await fetch(`${baseUrl}/v1/auth/refresh`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ refreshToken, deviceId: "smoke-test" }),
  });
  assertOk(refreshRes.ok, `refresh failed: ${refreshRes.status}`);
  const refreshed = await refreshRes.json();
  assertOk(typeof refreshed?.accessToken === "string", "refresh accessToken missing");
  assertOk(typeof refreshed?.refreshToken === "string", "refresh refreshToken missing");

  const logoutRes = await fetch(`${baseUrl}/v1/auth/logout`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ refreshToken: refreshed.refreshToken }),
  });
  assertOk(logoutRes.ok, `logout failed: ${logoutRes.status}`);

  console.log(
    JSON.stringify(
      {
        ok: true,
        baseUrl,
        registerEmail,
        createdUserEmail: newUserEmail,
        createdUserPin: newUserPin,
        cashierLoginOk: true,
        cashierForbiddenUsersEndpoint: true,
      },
      null,
      2,
    ),
  );
};

await main();

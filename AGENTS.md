# Novex-Code — SaaS Starter Kit (v0.1.0)

پلتفرم محتوای فارسی (CMS + فروشگاه) با استک آسترو،قابل اجرا در Docker، و پشتیبانی از RBAC و افزونه‌های استاندارد.

## نقشه فایل مهم

```
src/lib/cms/auth.ts         # احراز هویت، نشست (HMAC cookie)، سقف تلاش ناموفق
src/lib/cms/users.ts        # مدیریت کاربران (data/users.json)، Create/Read/Update/Delete
src/lib/cms/rbac.ts         # کنترل دسترسی بر اساس نقش (admin/editor/contributor/subscriber)
src/lib/cms/settings.ts     # تنظیمات سایت (data/cms-settings.json)
src/lib/cms/posts.ts        # فایل‌های وبلاگ (src/content/blog/*.md)
src/lib/cms/fa.ts           # تقویم جلالی، اعداد فارسی، captionهای فارسی
src/lib/commerce/{types,orders,db,cart,discounts}.ts  # فیکتور فروشگاه (JSON store)
src/lib/plugins/{registry,types,hooks,store,html}.ts   # سیستم افزونه استاندارد
src/pages/cms/api/users/*   # REST API کاربران (GET/POST/PATCH/DELETE)
src/pages/cms/api/login.ts  # ورود_panel
src/pages/cms/api/logout.ts # خروج
src/pages/cms/users.astro   # صفحه مدیریت کاربران در پنل
plugins/*/plugin.json       # مانیفست افزونه (استاندارد وردپرس + EmDash capabilities)
```

## چطور توسعه دهید

### ۱. پیش‌نیازها
Node.js >= 22.23.4 (از `--experimental-strip-types` برای تست‌های `.ts` استفاده می‌شود).

```bash
npm install --legacy-peer-deps --ignore-engines
```

### ۲. اجرا در توسعه
```bash
npm run dev
# سرور روی http://localhost:4321
```

### ۳. تست‌ها
```bash
npm test
# یا به صورت جداگانه:
node --experimental-strip-types --test tests/
```

### ۴. ساخت و اجرا در تولید
```bash
npm run build        # خروجی در dist/
npm run preview      # سرور استاتیک
# یا با Docker:
docker compose up --build -d
```

### ۵. متغیرهای محیطی (.env)
```bash
cp .env.example .env
# ویرایش .env
CMS_USERNAME=admin
CMS_PASSWORD=your-secure-password
CMS_SESSION_SECRET=64-chars-random-string
CMS_COOKIE_SECURE=false   # فقط برای HTTP محلی
SITE_URL=http://localhost:4321
```

## RBAC — نقش‌ها و مجوزها

| نقش | مجوزها |
|------|---------|
| `admin` | دسترسی کامل (کاربران، افزونه‌ها، تنظیمات، پست، محصول، سفارش) |
| `editor` | نوشته/محصول، رسانه، سفارش (بدون مدیریت کاربر/افزونه) |
| `contributor` | فقط ایجاد نوشته (نیاز به تایید مدیر) |
| `subscriber` | فقط خواندن |

افزودن مجوز جدید: در `src/lib/cms/rbac.ts` به type `Permission` و `ROLE_PERMISSIONS` اضافه کنید.

## سیستم افزونه

هر افزونه یک پوشه در `plugins/<id>/` دارد:
- `plugin.json` — مانیفست (نام، نسخه، نوشنده، capabilities، admin.pages، settings، hooks)
- `index.ts` — نقطه ورود (`register(api)`)، optional `activate`/`deactivate`/`uninstall`
- `readme.txt` — قالب رسمی وردپرس

فعالسازی/غیرفعال‌سازی/حذف از طریق `/cms/plugins` یا API `/cms/api/plugins`.

## APIهای کلیدی

| Route | Method | توضیح |
|-------|--------|-------|
| `/api/health` | GET | سلامت سرویس |
| `/cms/api/login` | POST | ورود به پنل |
| `/cms/api/logout` | POST | خروج |
| `/cms/api/users` | GET/POST | لیست/ساخت کاربر (فقط admin) |
| `/cms/api/users/:id` | GET/PATCH/DELETE | عملیات کاربر خاص (فقط admin) |
| `/cms/api/plugins` | POST | activate/deactivate/save-options/uninstall |
| `/cms/api/posts` | GET/POST | مدیریت نوشته‌ها |
| `/cms/api/products` | GET/POST | مدیریت محصولات |
| `/cms/api/orders` | GET | لیست سفارشات |
| `/shop/api/cart` | POST | عملیات سبد خرید |
| `/shop/api/checkout` | POST | ثبت سفارش + راه‌اندازی پرداخت (زیرین‌پال) |
| `/shop/api/payment/callback` | GET | تایید پرداخت از درگاه |

## استانداردها که این پروژه دنبال می‌کند

- **افزونه:** هدر `plugin.json` (معادل WordPress) + `readme.txt` + چرخه‌عمر `activate/deactivate/uninstall`.
- **Capabilities:** همان ایده EmDash — هسته فقط همان دسترسی را می‌دهد که در مانیفست اعلام شده است.
- **RTL:** پنل و فروشگاه کاملاً راست‌به‌چپ با فونت Vazirmatn و تقویم جلالی.
- **دocker:** 3-stage Dockerfile (deps → build → runtime) + compose با والیوم‌های داده.

## چطور یک ویژگی جدید اضافه کنید

1. فایل مربوطه در `src/lib/cms/` یا `src/lib/commerce/` بسازید.
2. تست در `tests/` بنویسید.
3. `npm run check` (TypeScript) و `npm test` را اجرا کنید.
4. `npm run build` را بزنید و به `dist/`atikل کنید.

## ارتقا

نسخه‌ها به semver پیروی می‌کنند. تغییرات خراب‌کننده (breaking) در نسخه minor được documenting می‌شود.

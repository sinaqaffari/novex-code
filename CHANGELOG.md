# 노reckتش‌ها (ChangeLog)

تمام تغییرات قابل توجه در این پروژه در این فایلdocument شده است.

فرمت بر اساس [Keep a Changelog](https://keepachangelog.com/en/1.0.0/) است و این پروژه به [Semantic Versioning](https://semver.org/spec/v2.0.0.html) پایبند است.

## [0.1.1] — ۲۰۲۶-۱۰-۲۴

### افزوده شده
- **کیت فروشگاهی فارسی کامل** — فاکتور، گزارش درآمد، مدیریت وضعیت سفارش
- **صفحه فاکتور چاپی** — `/shop/invoice/[number]` با تاریخ جلالی، اقلام، المجموع و دکمه چاپ
- **صفحه گزارش درآمد** — `/cms/reports/revenue` با نمودار ستونی، KPIها، بیش‌فروش‌ترین‌ها و آخرین سفارش‌ها
- **تست‌های پایان به انتهای (E2E) پرداخت** — `tests/e2e/payment-e2e.test.ts` (۱۰ تست، ۰ خطا) simulate جریان کامل سفارش → پرداخت → تایید در حالت سندباکس زیرین‌پال
- **نسخه‌بندی importها** — تمام importهای نسبی در `src/lib/commerce/` با پسوند `.ts` برای سازگاری با Node.js `--experimental-strip-types`

### تغییر شده
- `src/pages/shop/order/[number].astro` — دکمه «مشاهدهٔ فاکتور» برای سفارش‌های غیرتکمیلی
- `src/components/cms/CmsLayout.astro` — گروه ناوبری «گزارش درآمد» در منوی فروشگاه
- `src/lib/commerce/*.ts` — importهای نسبی به `.ts` اصلاح شدند

## [0.1.0] — ۲۰۲۶-۱۰-۲۴

### افزوده شده
- **SaaS Starter Kit** — احراز هویت، RBAC، Docker، تست‌های خودکار، مستندات اجرا‌پذیر
- **سیستم کاربران (Multi-user)** — `src/lib/cms/users.ts` با ذخیره در `data/users.json` (Create/Read/Update/Delete)
- **کنترل دسترسی بر اساس نقش (RBAC)** — `src/lib/cms/rbac.ts` با ۴ نقش: admin, editor, contributor, subscriber
- **صفحه مدیریت کاربران** — `/cms/users` (فقط admin)
- **APIهای REST کاربران** — `GET/POST /cms/api/users`، `GET/PATCH/DELETE /cms/api/users/:id`
- **تست‌های خودکار** — `tests/auth.test.ts` و `tests/rbac.test.ts` (۱۵ تست، ۰ خطا)
- **AGENTS.md** — راهنمای توسعه برای ایجنت‌ها و توسعه‌دهندگان
- **CHANGELOG.md** — این فایل

### تغییر شده
- `auth.ts` — حالا از `users.ts` برای اعتبارسنجی استفاده می‌کند (نه فقط کاربر ثابت محیط)
- `login.ts` — نقش کاربر در session ذخیره می‌شود
- `middleware.ts` — حفاظ RBAC برای مسیرهای حساس (فقط متغیرهای غیرخواندنی)
- `package.json` — نسخه 0.1.0، اسکریپت `test` و `test:ci` اضافه شد

### فیکس شده
- `users.astro` — JSX در Astro با شرایط چک‌باکس و type-safe Role

## [0.0.1] — قبلی

- پنل مدیریت فارسی (RTL) با فونت Vazirmatn
- فروشگاه (سبد خرید، سفارش، محصول، تخفیف)
- سیستم افزونه استاندارد (plugin.json + index.ts + readme.txt)
- افزونه‌های پیش‌فرض: سئو، بازبینی محتوا
- Dockerfile + docker-compose.yml
- تقویم جلالی و اعداد فارسی

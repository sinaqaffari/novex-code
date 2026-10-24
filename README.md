# نووکس‌کد — مجله و فروشگاه، با یک پنل مدیریت فارسی

یک پلتفرم کامل — وبلاگ، فروشگاه و پنل مدیریت — که از پایه برای فارسی و راست‌به‌چپ
نوشته شده است. پنل به‌اندازهٔ WordPress کامل است، اما سبک‌تر، مرتب‌تر و بدون وصله‌های
RTL. همه‌چیز با [Astro](https://astro.build) و یک فایل JSON محلی کار می‌کند؛ بدون
پایگاه‌داده، بدون سرویس ابری و بدون وابستگی بیرونی.

```sh
cp .env.example .env
npm install
npm run dev      # http://localhost:4321  →  پنل: http://localhost:4321/cms
```

> نیازمند Node.js نسخهٔ **22.23.4** یا بالاتر (الزام Astro 7).

---

## ۱. اجرا با Docker

دو راه دارید: تصویر آماده یا فایل compose.

```sh
# راه ساده — compose
cp .env.example .env
docker compose up --build -d
docker compose logs -f app      # دیدن لاگ‌ها
docker compose down             # توقف
```

```sh
# یا ساخت و اجرای دستی تصویر
docker build -t novex-code .
docker run -d --name novex-code -p 4321:4321 \
  -e CMS_SESSION_SECRET="$(openssl rand -hex 32)" \
  -e CMS_PASSWORD="یک-گذرواژهٔ-قوی" \
  -v novex-data:/app/data \
  -v novex-blog:/app/src/content/blog \
  -v novex-uploads:/app/src/assets/uploads \
  novex-code:latest
```

سپس سایت روی `http://localhost:4321`، پنل روی `http://localhost:4321/cms` و بررسی
سلامت روی `http://localhost:4321/api/health` در دسترس است.

### چه چیزی پایدار می‌ماند؟

| والیوم | مسیر داخل کانتینر | محتوا |
| --- | --- | --- |
| `novex-data` | `/app/data` | تنظیمات سایت و دادهٔ فروشگاه (`commerce.json`) |
| `novex-blog` | `/app/src/content/blog` | نوشته‌هایی که از پنل ذخیره می‌شوند |
| `novex-uploads` | `/app/src/assets/uploads` | تصویرهای بارگذاری‌شده |

تصویر چندمرحله‌ای است (`deps` → `build` → `runtime`)، با کاربر غیرروت `node` اجرا
می‌شود و یک `HEALTHCHECK` روی `/api/health` دارد. اگر به‌جای والیوم از bind mount
استفاده می‌کنید، مالکیت پوشه‌ها را به کاربر `node` (UID 1000) بدهید.

### متغیرهای محیطی

| متغیر | پیش‌فرض | توضیح |
| --- | --- | --- |
| `PORT` | `4321` | پورت سرور |
| `HOST` | `0.0.0.0` | در Docker باید `0.0.0.0` باشد |
| `TZ` | `Asia/Tehran` | منطقهٔ زمانی سرور |
| `CMS_USERNAME` | `admin` | نام کاربری مدیر |
| `CMS_PASSWORD` | `novex-admin` | گذرواژهٔ ساده — فقط توسعه |
| `CMS_PASSWORD_HASH` | — | هش scrypt؛ در محیط عملیاتی جایگزین گذرواژهٔ ساده |
| `CMS_SESSION_SECRET` | موقت | کلید امضای کوکی نشست؛ در عملیات الزامی |
| `CMS_COOKIE_SECURE` | `true` در production | اگر پشت HTTPS نیستید `false` بگذارید |

---

## ۲. پنل مدیریت (`/cms`)

| نشانی | کاربرد |
| --- | --- |
| `/cms` | داشبورد: درآمد، سفارش‌ها، نمودار ۱۴ روزه، موجودی کم، پربازدیدترین محصولات |
| `/cms/posts` | فهرست نوشته‌ها با جست‌وجو، پالایش و صفحه‌بندی |
| `/cms/posts/new` | ویرایشگر مارک‌داون با پیش‌نمایش زنده |
| `/cms/media` | کتابخانهٔ رسانه، بارگذاری و حذف تصویر |
| `/cms/products` | محصولات: قیمت، قیمت پیش از تخفیف، موجودی، SKU، وضعیت، ویژه |
| `/cms/orders` | سفارش‌ها با پالایش وضعیت و صفحه‌بندی |
| `/cms/orders/<id>` | جزئیات سفارش، خط زمانی، تغییر وضعیت، یادداشت داخلی |
| `/cms/customers` | مشتریان با تعداد سفارش و ارزش طول عمر (LTV) |
| `/cms/discounts` | کدهای تخفیف درصدی/ثابت با سقف استفاده و تاریخ انقضا |
| `/cms/settings` | تنظیمات سایت، تاریخ، ارقام و ماژول فروشگاه |
| `/cms/search` | جست‌وجوی سراسری در نوشته‌ها، محصولات و سفارش‌ها |
| `/cms/language` | قرارداد زبان و چیدمان و راهنمای نگهداری RTL |

### ورود و امنیت

پنل با یک حساب مدیر و کوکی امضاشده (HMAC) محافظت می‌شود؛ همهٔ مسیرهای `/cms`
— صفحه‌ها، APIها و فایل‌های رسانه — از `src/middleware.ts` عبور می‌کنند. پس از پنج
تلاش ناموفق، ورود برای پنج دقیقه قفل می‌شود و پاسخ‌های پنل با
`cache-control: no-store` و `x-robots-tag: noindex` ارسال می‌شوند.

### قرارداد API

همهٔ نقاط پایانی زیر `/cms/api/*` قرار دارند و منبع‌محور طراحی شده‌اند:

```text
GET    /cms/api/products            فهرست (query, status, page)
POST   /cms/api/products            ساخت (پاسخ: { ok, id, redirect })
POST   /cms/api/products/<id>       ویرایش / action=duplicate|status|delete
DELETE /cms/api/products/<id>       حذف
POST   /cms/api/orders/<id>         action=status|note
POST   /cms/api/discounts          ساخت کد
POST   /cms/api/discounts/<id>      action=toggle|delete
```

خطاها همیشه به یک شکل برمی‌گردند — با ارسال `Accept: application/json` از بازگشت
HTML جلوگیری می‌کنید:

```json
{ "ok": false, "message": "نام محصول الزامی است.", "field": "name" }
```

---

## ۳. فروشگاه (`/shop`)

| نشانی | کاربرد |
| --- | --- |
| `/shop` | فهرست محصولات فعال، پیشنهاد ویژه |
| `/shop/<slug>` | جزئیات محصول، موجودی، افزودن به سبد |
| `/shop/cart` | سبد خرید، تعداد، کد تخفیف، هزینهٔ ارسال |
| `/shop/checkout` | اطلاعات تحویل و ثبت سفارش |
| `/shop/order/<NVX-…>` | صورتحساب، خط زمانی وضعیت، اطلاعات تحویل |
| `/shop/track` | پیگیری با شمارهٔ سفارش و شمارهٔ تماس |

قواعد تجاری:

- ارسال: `۴۵٬۰۰۰ تومان` — برای سفارش‌های بالای `۱٬۰۰۰٬۰۰۰ تومان` رایگان.
- تخفیف هرگز از جمع کالاها بیشتر نمی‌شود؛ مبلغ نهایی = `max(0, جمع − تخفیف) + ارسال`.
- قیمت‌ها همیشه از سرور خوانده می‌شوند، نه از سبد خرید کاربر.
- وضعیت‌ها: `pending → paid → processing → shipped → delivered` و شاخه‌های
  `cancelled` / `refunded`. فقط چهار وضعیت میانی در درآمد حساب می‌شوند.
- لغو یا بازگشت وجه، موجودی را به انبار برمی‌گرداند و ظرفیت کد تخفیف را آزاد می‌کند.
- دسترسی به سفارش با شماره + شمارهٔ تماس (یا کوکی سفارش تازه) تأیید می‌شود.

ماژول فروشگاه از `/cms/settings` قابل خاموش‌کردن است؛ در آن حالت لینک‌های فروشگاه،
داشبورد تجاری و صفحه‌های خرید کنار می‌روند و مجله سر جایش می‌ماند.

---

## ۴. مجلهٔ عمومی

`/`، `/blog`، `/blog/<slug>` و `/about` همگی فارسی و راست‌به‌چپ‌اند و از همان
تنظیمات سایت تغذیه می‌شوند. برخلاف نسخهٔ قبلی، فهرست و متن نوشته‌ها در زمان اجرا از
`src/content/blog` خوانده می‌شوند؛ پس نوشتهٔ تازه‌ای که از پنل منتشر می‌شود، **بدون
ساخت دوبارهٔ پروژه** در سایت دیده می‌شود.

---

## ۵. راست‌به‌چپ به‌عنوان قرارداد

- `<html lang="fa" dir="rtl">` در `src/layouts/SiteLayout.astro` و `src/components/cms/CmsLayout.astro`.
- چیدمان فقط با ویژگی‌های منطقی CSS (`margin-inline`, `padding-inline-start`,
  `text-align: start`, `inset-inline-*`).
- قلم فارسی [وزیرمتن](https://github.com/rastikerdar/vazirmatn) به‌صورت self-hosted.
- همهٔ عددها با `Intl.NumberFormat('fa-IR')` و همهٔ تاریخ‌ها با تقویم هجری شمسی
  (`fa-IR-u-ca-persian`) در `src/lib/cms/fa.ts` قالب می‌شوند.
- متن لاتین (نامک، نشانی، ایمیل، کد، بلوک کد) با `dir="ltr"` و `unicode-bidi: isolate` جدا می‌شود.

```sh
npm run check:rtl     # بررسی خودکار؛ در صورت نقض قرارداد با کد خطا خارج می‌شود
```

اسکریپت، ویژگی‌های فیزیکی CSS، متن انگلیسی جاافتاده در رابط کاربری، صفحه‌های بدون
چیدمان درست و نبودِ قلم فارسی را تشخیص می‌دهد. اگر جایی عمداً به ویژگی فیزیکی نیاز
بود، همان خط را با `rtl-check-ignore` علامت بزنید.

---

## ۶. ساختار پروژه

```text
src/
├─ middleware.ts                 # محافظت از /cms (صفحه، API و رسانه)
├─ layouts/
│  ├─ SiteLayout.astro           # پوستهٔ عمومی فارسی (مجله)
│  └─ ShopLayout.astro           # پوستهٔ فروشگاه
├─ components/cms/               # CmsLayout، Icon، PostEditor، ProductForm، Pagination
├─ lib/
│  ├─ cms/                       # auth، posts، media، settings، fa، http، input
│  ├─ commerce/                  # types، db، validation، products، orders، discounts، cart، stats
│  └─ errors.ts                  # AppError با پیام و فیلد فارسی
├─ pages/
│  ├─ index / blog / about       # سایت عمومی
│  ├─ shop/                      # فروشگاه، سبد، تسویه، پیگیری
│  ├─ cms/                       # پنل مدیریت و APIها
│  ├─ media/[...path].ts         # سرو عمومی تصویرهای بارگذاری‌شده
│  └─ api/health.ts              # بررسی سلامت (Docker healthcheck)
└─ styles/                       # cms.css و shop.css — سیستم طراحی RTL
```

داده‌های زمان اجرا در `data/` (`cms-settings.json` و `commerce.json`) و
`src/content/blog/` و `src/assets/uploads/` نگه‌داری می‌شوند و در Git نیستند.

---

## ۷. دادهٔ نمونه

در نخستین اجرا، `data/commerce.json` با دادهٔ نمونه ساخته می‌شود: ۵ محصول، ۴ مشتری،
۸ سفارش (`NVX-1032` تا `NVX-1039`) و دو کد تخفیف — `NOWRUZ25` (۲۵٪ فعال) و
`WELCOME100` (ثابت، غیرفعال). برای شروع از صفر، فایل را پاک کنید.

---

## ۸. اسکریپت‌ها

```sh
npm run dev        # سرور توسعه
npm run build      # ساخت خروجی سروری (adapter: node standalone)
npm run preview    # پیش‌نمایش خروجی
npm run check      # astro check (نوع‌ها + قالب‌ها)
npm run check:rtl  # بررسی قرارداد راست‌به‌چپ
```

## ۹. قالب اصلی

این پروژه از قالب وبلاگ Astro (بر پایهٔ Bear Blog، با مجوز MIT) شروع شده و سپس
پوستهٔ عمومی، پنل مدیریت و ماژول فروشگاه از نو نوشته شده‌اند.

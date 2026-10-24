# نووکس‌کد — مجله + پنل مدیریت فارسی

پروژه بر پایهٔ [Astro](https://astro.build) است و شامل یک پنل مدیریت محتوای کامل، فارسی و
راست‌به‌چپ می‌شود. پنل، نوشته‌ها و تنظیمات سایت را مستقیم روی فایل‌های مخزن مدیریت می‌کند؛
بدون پایگاه‌داده و بدون سرویس خارجی.

## اجرا

```sh
npm install
npm run dev      # http://localhost:4321  →  پنل: http://localhost:4321/cms
```

> نیازمند Node.js نسخهٔ **22.23.4** یا بالاتر (الزام خود Astro 7).

## پنل مدیریت (‎/cms‎)

| نشانی | کاربرد |
| --- | --- |
| `/cms` | داشبورد: آمار محتوا، آخرین نوشته‌ها، پرکاربردترین برچسب‌ها |
| `/cms/posts` | فهرست نوشته‌ها با جست‌وجو و پالایش وضعیت |
| `/cms/posts/new` | ساخت نوشتهٔ تازه |
| `/cms/posts/<file>.md` | ویرایش نوشته با پیش‌نمایش زندهٔ مارک‌داون |
| `/cms/media` | کتابخانهٔ رسانه و بارگذاری تصویر |
| `/cms/settings` | تنظیمات سایت، تاریخ، ارقام و انتشار |
| `/cms/language` | قرارداد زبان/چیدمان و راهنمای نگهداری RTL |

### ورود

پنل با یک حساب مدیر و کوکی امضاشده (HMAC) محافظت می‌شود:

```sh
cp .env.example .env
# مقادیر پیش‌فرض توسعه:
#   نام کاربری: admin
#   گذرواژه:    novex-admin
```

برای محیط عملیاتی حتماً `CMS_USERNAME`، `CMS_PASSWORD_HASH` (هش scrypt) و
`CMS_SESSION_SECRET` را تنظیم کنید. پس از پنج تلاش ناموفق، ورود برای پنج دقیقه قفل می‌شود.

### راست‌به‌چپ و فارسی

رعایت این قرارداد در کد و با اسکریپت بررسی می‌شود:

- `<html lang="fa" dir="rtl">` در `src/components/cms/CmsLayout.astro`.
- چیدمان فقط با ویژگی‌های منطقی CSS (`margin-inline`, `padding-inline-start`,
  `text-align: start`, `inset-inline-*`).
- قلم فارسی [وزیرمتن](https://github.com/rastikerdar/vazirmatn) به‌صورت self-hosted.
- همهٔ عددها با `Intl.NumberFormat('fa-IR')` و همهٔ تاریخ‌ها با تقویم هجری شمسی
  (`fa-IR-u-ca-persian`) در `src/lib/cms/fa.ts` قالب می‌شوند.
- متن لاتین (نامک، نشانی، ایمیل، کد) با `dir="ltr"` و `unicode-bidi: isolate` جدا می‌شود.

```sh
npm run check:rtl     # بررسی خودکار؛ در صورت نقض قرارداد با کد خطا خارج می‌شود
```

اسکریپت، ویژگی‌های فیزیکی CSS، متن انگلیسی جاافتاده در رابط کاربری، صفحه‌های بدون
`CmsLayout` و نبودِ قلم فارسی را تشخیص می‌دهد. اگر جایی عمداً به ویژگی فیزیکی نیاز بود،
همان خط را با `rtl-check-ignore` علامت بزنید.

### ساختار پنل

```text
src/
├─ middleware.ts              # محافظت از /cms (صفحه‌ها، API و فایل‌های رسانه)
├─ env.d.ts                   # نوع App.Locals.cmsSession
├─ lib/cms/
│  ├─ auth.ts                 # ورود، کوکی امضاشده، قفل تلاش‌های ناموفق
│  ├─ posts.ts                # خواندن/نوشتن نوشته‌ها در src/content/blog
│  ├─ frontmatter.ts          # خواندن و نوشتن YAML بدون وابستگی
│  ├─ media.ts                # کتابخانهٔ رسانه در src/assets/uploads
│  ├─ settings.ts             # تنظیمات در data/cms-settings.json
│  ├─ fa.ts                   # قالب‌بندی فارسی (عدد، تاریخ جلالی، زمان مطالعه)
│  ├─ http.ts / input.ts      # کمک‌کننده‌های درخواست/پاسخ
├─ components/cms/            # CmsLayout، Icon، PostEditor
├─ pages/cms/                 # صفحه‌ها و APIها (api/login، api/posts، api/media، …)
└─ styles/cms.css             # سیستم طراحی RTL پنل
```

### انتشار محتوا

پنل فایل‌ها را بلافاصله روی دیسک می‌نویسد:

- در حالت `npm run dev`، Astro تغییر فایل‌های محتوا را می‌بیند و صفحه‌های عمومی
  (`/blog/...`) در چند لحظه به‌روز می‌شوند.
- در استقرار عملیاتی (`output: 'server'`)، محتوای سایت از مخزن محتوایی خوانده می‌شود که
  هنگام `npm run build` ساخته شده است؛ پس از انتشار یک نوشته، یک بازسازی/استقرار دوباره
  (`npm run build`) لازم است — همان الگویی که CMSهای فایل‌محور مثل Decap و Tina دارند.

## سایت

```sh
npm run build     # ساخت خروجی سروری (adapter: node standalone)
npm run preview   # پیش‌نمایش خروجی
```

صفحه‌های عمومی: `/`، `/blog`، `/blog/<slug>`، `/about`، `/rss.xml`. نوشته‌های
`draft: true` در فهرست مجله و فید RSS نمایش داده نمی‌شوند.

## قالب اصلی

این پروژه از قالب وبلاگ Astro (بر پایهٔ Bear Blog، با مجوز MIT) شروع شده است.

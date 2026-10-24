/// <reference types="astro/client" />

declare namespace App {
	interface Locals {
		cmsSession: import('./lib/cms/auth').SessionPayload | null;
<<<<<<< HEAD
=======
		cmsUser: { username: string; role: import('./lib/cms/rbac').Role } | null;
>>>>>>> eec85ad (بازنویسی UI پنل مدیریت — تمیز، راست‌به‌چپ، بدون زیربنای وردپرس)
	}
}

/// <reference types="astro/client" />

declare namespace App {
	interface Locals {
		cmsSession: import('./lib/cms/auth').SessionPayload | null;
		cmsUser: { username: string; role: import('./lib/cms/rbac').Role } | null;
	}
}

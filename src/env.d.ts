/// <reference types="astro/client" />

declare namespace App {
	interface Locals {
		cmsSession: import('./lib/cms/auth').SessionPayload | null;
	}
}

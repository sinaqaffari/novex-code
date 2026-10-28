export interface DemoSeedOptions {
	databaseFile?: string;
	apply?: boolean;
	production?: boolean;
}

export interface DemoSeedResult {
	target: string;
	added: number;
	total: number;
	before: number;
	applied: boolean;
}

export function seedDemoProducts(options?: DemoSeedOptions): Promise<DemoSeedResult>;

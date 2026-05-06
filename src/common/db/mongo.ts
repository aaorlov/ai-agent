import { MongoClient } from "mongodb";

import { logger } from "@/common/utils";
import { env } from "@/config";

class MongoService {
	readonly client: MongoClient;
	private isConnected = false;

	constructor() {
		this.client = new MongoClient(env.MONGODB_URL);
	}

	async connect(): Promise<void> {
		if (this.isConnected) return;
		await this.client.connect();
		this.isConnected = true;
		logger.info("MongoDB connected", { db: env.MONGODB_DB_NAME });
	}

	async disconnect(): Promise<void> {
		if (!this.isConnected) return;
		await this.client.close();
		this.isConnected = false;
		logger.info("MongoDB connection closed");
	}
}

export const mongoService = new MongoService();

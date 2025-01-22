// This file extends the AdapterConfig type from "@types/iobroker"

// Augment the globally declared type ioBroker.AdapterConfig
declare global {
	namespace ioBroker {
		interface AdapterConfig {
            ipaddress: string;
            polltimelive: number;
            StateHomeBatSoc: string;
            StateHomeSolarPower: string;
            StateHomePowerConsumption: string;
            SubtractSelfConsumption: boolean;
            ReadOnlyMode: boolean
		}
	}
}

// this is required so the above AdapterConfig is found by TypeScript / type checking
export {};

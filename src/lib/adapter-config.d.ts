// This file extends the AdapterConfig type from "@types/iobroker"

// Augment the globally declared type ioBroker.AdapterConfig
declare global {
	namespace ioBroker {
		interface AdapterConfig {
            polltimelive: number;
            StateHomeBatSoc: string;
            StateHomeSolarPower: string;
            StateHomePowerConsumption: string;
            SubtractSelfConsumption: boolean;
            ipaddress: string;
            ReadOnlyMode: boolean
		//WiP: Multiple chargers
            //ChargerList: [
			//{
                        //ipAddress: string;
                        //readOnlyMode: boolean
			//},
		//];
            }
	}
}

// this is required so the above AdapterConfig is found by TypeScript / type checking
export {};

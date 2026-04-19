// This file extends the AdapterConfig type from "@types/iobroker"

// Augment the globally declared type ioBroker.AdapterConfig
declare global {
	namespace ioBroker {
		interface AdapterConfig {
                  cycleTime : number;
                  stateHomeBatSoc: string;
                  stateHomeSolarPower: string;
                  stateHomePowerConsumption: string;
                  subtractSelfConsumption: boolean;
                  //ipaddress: string;
                  //ReadOnlyMode: boolean
		      wallBoxList: [
			      {
                              ipAddress: string;
                              readOnlyMode: boolean
			      },
		      ];
            }
	}
}

// this is required so the above AdapterConfig is found by TypeScript / type checking
export {};

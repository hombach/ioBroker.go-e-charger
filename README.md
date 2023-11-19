![Logo](admin/go-eCharger.png)
# ioBroker.go-eCharger

[![NPM version](http://img.shields.io/npm/v/iobroker.go-e-charger.svg)](https://www.npmjs.com/package/iobroker.go-e-charger)
[![Downloads](https://img.shields.io/npm/dm/iobroker.go-e-charger.svg)](https://www.npmjs.com/package/iobroker.go-e-charger)
![Number of Installations (latest)](http://ioBroker.live/badges/template-installed.svg)
![Number of Installations (stable)](http://ioBroker.live/badges/template-stable.svg)
[![Known Vulnerabilities](https://snyk.io/test/github/hombach/ioBroker.go-e-charger/badge.svg)](https://snyk.io/test/github/hombach/ioBroker.go-e-charger)
![Node.js CI](https://github.com/hombach/ioBroker.go-e-charger/workflows/Node.js%20CI/badge.svg)

[![NPM](https://nodei.co/npm/iobroker.go-e-charger.png?downloads=true)](https://nodei.co/npm/iobroker.go-e-charger/)

**Tests:**: [![Appveyor-CI](https://ci.appveyor.com/api/projects/status/github/hombach/ioBroker.go-e-charger?branch=master&svg=true)](https://ci.appveyor.com/project/hombach/iobroker-go-e-charger)


## Adapter for reading go-eCharger data for iOBroker
Adapter for reading go-eCharger data. Adapter creates some states and updates sequentially. Adapter is connectable to PV-system to make use of surplus solar power for charging your car. Working with firmware V033, V040.0, V041.0, V054.7.
For use with Hardware Generation 3 & 4 you have to enable "HTTP API v1"

### Settings
To connect to the go-eCharger type in its IP-address in the config.

## Notes
This adapter uses Sentry libraries to automatically report exceptions and code errors to the developers. For more details and for informations on how to disable the error reporting see [Sentry-Plugin Documentation](https://github.com/ioBroker/plugin-sentry#plugin-sentry)! Sentry reporting is used starting with js-controller 3.0.

## Changelog
! Note that missing version entries are typically dependency updates for security.

### 0.16.1 (19.11.2023)
* (HombachC) Add support for V054.11
### 0.16.0 (18.11.2023)
* (HombachC) replaced got by axios
### 0.15.5 (18.11.2023)
* (HombachC) Add support for V054.7, Several dependency updates, code cleanup
### 0.15.4 (01.10.2023)
* (HombachC) Several dependency updates, bump adapter-core to 3.x
### 0.15.3 (29.06.2023)
* (HombachC) acknowledge settings states after adoption
### 0.15.2 (26.06.2023)
* (HombachC) Changed config screen to ioBroker.admin 5 version
### 0.15.1 (19.06.2023)
* (HombachC) removed travis
### 0.15.0 (15.06.2023)
* (HombachC) BREAKING: dropped node.js 14 support
* (HombachC) Add tests for node.js 20, removed for node.js 14, bumped dependencies
* (HombachC) BREAKING: dropped ioBroker.admin 4 support
### 0.14.4 (09.04.2023)
* (HombachC) bumped dependencies
### 0.14.3 (29.12.2022)
* (HombachC) bumped dependencies and year 2023 changes
### 0.14.2 (27.06.2022)
* (HombachC) bumped dependencies because of security vulnerability
### 0.14.1 (05.06.2022)
* (HombachC) bumped dependencies, small code tweaks, removed gulp
### 0.14.0 (08.05.2022)
* (HombachC) BREAKING: dropped node.js 12 support
* (HombachC) Add tests for node.js 18, removed for node.js 12
* (HombachC) bumped dependencies to non node.js 12 support
### 0.13.0 (06.05.2022)
* (HombachC) introducing read-only mode, bumped dependencies
### 0.12.0 (13.03.2022)
* (HombachC) optimize system load
### 0.11.3 (13.03.2022)
* (HombachC) fix sentry error, bumped dependencies
### 0.11.2 (28.01.2022)
* (HombachC) small docu tweaks, bumped dependencies
### 0.11.1 (02.01.2022)
* (HombachC) year 2022 changes, bumped dependencies
### 0.11.0 (17.12.2021)
* (HombachC) dropped node.js 10 support, bumped dependencies
### 0.10.2 (14.11.2021)
* (HombachC) sentry finding: added unknown firmware 040; prior only 040.0 included
### 0.10.1 (24.10.2021)
* (HombachC) fixing error in adapter start-up
* (HombachC) changed error with unsupported firmware to warning - run adapter also with this firmwares
### 0.10.0 (24.10.2021)
* (HombachC) added sentry.io support
### 0.9.2 (17.10.2021)
* (HombachC) fixed error in charger state feedback
### 0.9.0 (04.10.2021)
* (HombachC) support for firmware 041.0 
### 0.8.0 (09.05.2021)
* (HombachC) added gridphase correction to charge logic
### 0.7.5 (09.05.2021)
* (HombachC) added tests for node.js 16
### 0.7.0 (11.04.2021)
* (HombachC) added measured maximum current 
### 0.6.0 (15.03.2021)
* (HombachC) fix error in foreign state popup
### 0.5.0 (20.12.2020)
* (HombachC) introduces selectable external states for charge control
### 0.4.0 (11.12.2020)
* (HombachC) added use of amx (non persistent set of charge current) to protect hardware (firmware 040 only)
### 0.3.3 (08.12.2020)
* (HombachC) added check of firmware version
### 0.3.2 (08.12.2020)
* (HombachC) bumped dependencies, added poll of firmware version, fixed error in CarStateString
### 0.2.0 (11.09.2020)
* (HombachC) changed type to vehicle
### 0.0.1 (27.06.2020)
* (HombachC) initial release

## License
MIT License

Copyright (c) 2020 - 2023 HombachC

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

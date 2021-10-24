![Logo](admin/go-eCharger.png)
# ioBroker.go-eCharger

[![NPM version](http://img.shields.io/npm/v/iobroker.go-e-charger.svg)](https://www.npmjs.com/package/iobroker.go-e-charger)
[![Downloads](https://img.shields.io/npm/dm/iobroker.go-e-charger.svg)](https://www.npmjs.com/package/iobroker.go-e-charger)
![Number of Installations (latest)](http://ioBroker.live/badges/template-installed.svg)
![Number of Installations (stable)](http://ioBroker.live/badges/template-stable.svg)
[![Dependency Status](https://img.shields.io/david/hombach/ioBroker.go-e-charger.svg)](https://david-dm.org/hombach/ioBroker.go-e-charger)
[![Known Vulnerabilities](https://snyk.io/test/github/hombach/ioBroker.go-e-charger/badge.svg)](https://snyk.io/test/github/hombach/ioBroker.go-e-charger)
![Node.js CI](https://github.com/hombach/ioBroker.go-e-charger/workflows/Node.js%20CI/badge.svg)

[![NPM](https://nodei.co/npm/iobroker.go-e-charger.png?downloads=true)](https://nodei.co/npm/iobroker.go-e-charger/)

**Tests:**: [![Travis-CI](http://img.shields.io/travis/hombach/ioBroker.go-e-charger/master.svg)](https://travis-ci.org/hombach/ioBroker.go-e-charger)

## Adapter for reading go-eCharger data for iOBroker
Adapter for reading go-eCharger data. Adapter creates some states and updates sequentially. Working with firmware V033, V040.0, V041.0

### Settings
To connect to the go-eCharger type in its IP-address in the config.

## Notes
This adapter uses Sentry libraries to automatically report exceptions and code errors to the developers. For more details and for informations on how to disable the error reporting see [Sentry-Plugin Documentation](https://github.com/ioBroker/plugin-sentry#plugin-sentry)! Sentry reporting is used starting with js-controller 3.0.

## Changelog
! Note that missing version entries are typically dependency updates for security.
### 0.10.0 (24.10.2021)
* (HombachC) added sentry.io support
### 0.9.2 (17.10.2021)
* (HombachC) fixed error in charger state feedback
### 0.9.1 (16.10.2021)
* (HombachC) fixed vulnerability
### 0.9.0 (04.10.2021)
* (HombachC) support for firmware 041.0 
### 0.8.1 (16.07.2021)
* (HombachC) fixed vulnerability 
### 0.8.0 (09.05.2021)
* (HombachC) added gridphase correction to charge logic
### 0.7.5 (09.05.2021)
* (HombachC) added tests for node.js 16
### 0.7.2 (30.04.2021)
* (HombachC) fixed errors with js-controller 3.3.x, bumbed dependencies 
### 0.7.1 (11.04.2021)
* (HombachC) bug fix 
### 0.7.0 (11.04.2021)
* (HombachC) added measured maximum current 
### 0.6.0 (15.03.2021)
* (HombachC) fix error in foreign state popup
### 0.5.0 (20.12.2020)
* (HombachC) introduces selectable external states for charge control
### 0.4.1 (13.12.2020)
* (HombachC) fixed error in poll of pha to get available phases
### 0.4.0 (11.12.2020)
* (HombachC) added use of amx (non persistent set of charge current) to protect hardware (firmware 040 only)
### 0.3.3 (08.12.2020)
* (HombachC) added check of firmware version
### 0.3.2 (08.12.2020)
* (HombachC) bumped dependencies, added poll of firmware version, fixed error in CarStateString
### 0.2.0 (11.09.2020)
* (HombachC) changed type to vehicle
### 0.1.1 (30.06.2020)
* (HombachC) configurable IP
### 0.1.0 (28.06.2020)
* (HombachC) setup state machine - first working internal version
### 0.0.9 (28.06.2020)
* (HombachC) read charger power
### 0.0.1 (27.06.2020)
* (HombachC) initial release

## License
MIT License

Copyright (c) 2020 - 2021 HombachC

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

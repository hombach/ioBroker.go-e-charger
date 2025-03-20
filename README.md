![Logo](admin/go-eCharger.png)

# ioBroker.go-eCharger

[![NPM version](https://img.shields.io/npm/v/iobroker.go-e-charger?style=flat-square)](https://www.npmjs.com/package/iobroker.go-e-charger)
[![Downloads](https://img.shields.io/npm/dm/iobroker.go-e-charger?label=npm%20downloads&style=flat-square)](https://www.npmjs.com/package/iobroker.go-e-charger)
![node-lts](https://img.shields.io/node/v-lts/iobroker.go-e-charger?style=flat-square)
![Libraries.io dependency status for latest release](https://img.shields.io/librariesio/release/npm/iobroker.go-e-charger?label=npm%20dependencies&style=flat-square)

![GitHub](https://img.shields.io/github/license/hombach/iobroker.go-e-charger?style=flat-square)
![GitHub repo size](https://img.shields.io/github/repo-size/hombach/iobroker.go-e-charger?logo=github&style=flat-square)
![GitHub commit activity](https://img.shields.io/github/commit-activity/m/hombach/iobroker.go-e-charger?logo=github&style=flat-square)
![GitHub last commit](https://img.shields.io/github/last-commit/hombach/iobroker.go-e-charger?logo=github&style=flat-square)
![GitHub issues](https://img.shields.io/github/issues/hombach/iobroker.go-e-charger?logo=github&style=flat-square)

![GitHub Workflow Status](https://img.shields.io/github/actions/workflow/status/hombach/iobroker.go-e-charger/node.js.yml?branch=master&logo=github&style=flat-square)
[![CodeQL](https://github.com/hombach/ioBroker.go-e-charger/actions/workflows/codeql-analysis.yml/badge.svg)](https://github.com/hombach/ioBroker.go-e-charger/actions/workflows/codeql-analysis.yml)
[![Appveyor-CI](https://ci.appveyor.com/api/projects/status/github/hombach/ioBroker.go-e-charger?branch=master&svg=true)](https://ci.appveyor.com/project/hombach/iobroker-go-e-charger)
[![SNYK Known Vulnerabilities](https://snyk.io/test/github/hombach/ioBroker.go-e-charger/badge.svg)](https://snyk.io/test/github/hombach/ioBroker.go-e-charger)

## Versions

![Beta](https://img.shields.io/npm/v/iobroker.go-e-charger.svg?color=red&label=beta)
![Stable](https://iobroker.live/badges/go-e-charger-stable.svg)
![Installed](https://iobroker.live/badges/go-e-charger-installed.svg)

[![NPM](https://nodei.co/npm/iobroker.go-e-charger.png?downloads=true)](https://nodei.co/npm/iobroker.go-e-charger/)

## Adapter for reading go-eCharger data for iOBroker

Adapter for reading go-eCharger data. Adapter creates some states and updates sequentially. Adapter is connectable to PV-system to make use of surplus solar power for charging your car. Working with firmware V033, V040.0, V041.0, V054.7, V054.11, V055.5, V055.7, V055.8, V56.1, V56.2, V56.8, V56.9.

For use with hardware generation 3 & 4 you have to enable "HTTP API v1" in your go-e api.
For use with phase switching you need hardware generation 3 or 4 and additionally you have to enable "HTTP API v2" in your go-e api.

## Configuration

To connect to the go-eCharger type in its IP-address in the config.

## Sentry

This adapter employs Sentry libraries to automatically report exceptions and code errors to the developers. For more details and information on how to disable error reporting, please consult the [Sentry-Plugin Documentation](https://github.com/ioBroker/plugin-sentry#plugin-sentry)! Sentry reporting is initiated starting with js-controller 3.0.

## Changelog

### **WORK IN PROGRESS**

- (hombach) fix axios
- (hombach) bump dependencies

### 0.20.1 (2025-03-05)

- (hombach) bump dependencies

### 0.20.0 (2025-02-23)

- (hombach) change to admin 7.4.10 as recommended by ioBroker

### 0.19.8 (2025-01-28)

- (hombach) roll back bad ioBroker.testing
- (hombach) added support for firmware V57.0 (#659)
- (hombach) added support for firmware V57.1 (#660)

### 0.19.7 (2025-01-25)

- (hombach) added support for firmware V56.11 (#658)

### 0.19.6 (2025-01-23)

- (hombach) added support for firmware V56.9 (#657)
- (hombach) ported adapter to TypeScript
- (hombach) bumped dependencies
- (hombach) switch to ES2022
- (hombach) fixed chai

### 0.19.5 (2025-01-01)

- (hombach) harmonize tests, add tests for node 22
- (hombach) fix bug in state subscription
- (hombach) replace deprecated async state access
- (hombach) year 2025 changes
- (hombach) bumped dependencies

### 0.19.4 (2024-08-14)

- (hombach) fixed vulnerability in dependency

### 0.19.3 (2024-08-03)

- (hombach) added support for firmware V56.8

### 0.19.2 (2024-08-03)

- (hombach) added support for firmware V56.2

### 0.19.1 (2024-06-11)

- (hombach) fixed known vulnerability in dependency

### 0.19.0 (2024-05-30)

- (hombach) intruduced possibility to not subtract charger power from homeconsumption

### 0.18.1 (2024-05-28)

- (hombach) change test procedure to ioBroker standard
- (hombach) revert eslint to 8.57
- (hombach) add info.connection state (#564)
- (hombach) add node 21 tests
- (hombach) handle not reachable chargers (#563)

### 0.18.0 (2024-04-19)

- (hombach) BREAKING: dropped support for node.js 16 (#558)
- (hombach) BREAKING: js-controller >= 5 is required (#559)
- (hombach) updated adapter-core to 3.1.4

### 0.17.5 (2024-03-27)

- (hombach) smaller logo
- (hombach) corrected io-package.json according to new schema

### 0.17.4 (2024-03-27)

- (hombach) added support for firmware V56.1

### 0.17.3 (2024-03-27)

- (hombach) Update github workflows
- (hombach) update adapter-core to 3.0.6

### 0.17.2 (2024-01-16)

- (hombach) Fix error in calling API V2 on old HW

### 0.17.1 (2024-01-10)

- (hombach) Fix phases calculation error (#533)

### 0.17.0 (2024-01-10)

- (hombach) BREAKING: dropped support for js-controller 3.x
- (hombach) Implement API V2 to get and switch charging phases
- (hombach) optimized sentry logging

### 0.16.3 (2023-12-23)

- (hombach) add support for V055.8
- (hombach) year 2024 changes

### 0.16.2 (2023-11-19)

- (hombach) add support for V055.5 & V055.7
- (hombach) Change Sentry logging to new project

### 0.16.1 (2023-11-19)

- (hombach) Add support for V054.11

### 0.16.0 (2023-11-18)

- (hombach) replaced got by axios

### Old Changes see [CHANGELOG OLD](CHANGELOG_OLD.md)

## License
MIT License

Copyright (c) 2020-2025 C.Hombach

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

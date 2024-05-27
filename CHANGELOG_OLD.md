![Logo](admin/go-eCharger.png)

# ioBroker.go-eCharger

## Versions

![Beta](https://img.shields.io/npm/v/iobroker.go-e-charger.svg?color=red&label=beta)
![Stable](https://iobroker.live/badges/go-e-charger-stable.svg)
![Installed](https://iobroker.live/badges/go-e-charger-installed.svg)

[![NPM](https://nodei.co/npm/iobroker.go-e-charger.png?downloads=true)](https://nodei.co/npm/iobroker.go-e-charger/)

## Adapter for reading go-eCharger data for iOBroker
Adapter for reading go-eCharger data. Adapter creates some states and updates sequentially. Adapter is connectable to PV-system to make use of surplus solar power for charging your car. Working with firmware V033, V040.0, V041.0, V054.7, V054.11, V055.5, V055.7, V055.8, V56.1.

## Changelog - OLD CHANGES

### 0.16.0 (18.11.2023)

- (HombachC) replaced got by axios

### 0.15.5 (18.11.2023)

- (HombachC) Add support for V054.7, Several dependency updates, code cleanup

### 0.15.4 (01.10.2023)

- (HombachC) Several dependency updates, bump adapter-core to 3.x

### 0.15.3 (29.06.2023)

- (HombachC) acknowledge settings states after adoption

### 0.15.2 (26.06.2023)

- (HombachC) Changed config screen to ioBroker.admin 5 version

### 0.15.1 (19.06.2023)

* (HombachC) removed travis

### 0.15.0 (15.06.2023)

- (HombachC) BREAKING: dropped node.js 14 support
- (HombachC) Add tests for node.js 20, removed for node.js 14, bumped dependencies
- (HombachC) BREAKING: dropped ioBroker.admin 4 support

### 0.14.4 (09.04.2023)

- (HombachC) bumped dependencies

### 0.14.3 (29.12.2022)

- (HombachC) bumped dependencies and year 2023 changes

### 0.14.2 (27.06.2022)

- (HombachC) bumped dependencies because of security vulnerability

### 0.14.1 (05.06.2022)

- (HombachC) bumped dependencies, small code tweaks, removed gulp

### 0.14.0 (08.05.2022)

- (HombachC) BREAKING: dropped node.js 12 support
- (HombachC) Add tests for node.js 18, removed for node.js 12
- (HombachC) bumped dependencies to non node.js 12 support

### 0.13.0 (06.05.2022)

- (HombachC) introducing read-only mode, bumped dependencies

### 0.12.0 (13.03.2022)

- (HombachC) optimize system load

### 0.11.3 (13.03.2022)

- (HombachC) fix sentry error, bumped dependencies

### 0.11.2 (28.01.2022)

- (HombachC) small docu tweaks, bumped dependencies

### 0.11.1 (02.01.2022)

- (HombachC) year 2022 changes, bumped dependencies

### 0.11.0 (17.12.2021)

- (HombachC) dropped node.js 10 support, bumped dependencies

### 0.10.2 (14.11.2021)

- (HombachC) sentry finding: added unknown firmware 040; prior only 040.0 included

### 0.10.1 (24.10.2021)

- (HombachC) fixing error in adapter start-up
- (HombachC) changed error with unsupported firmware to warning - run adapter also with this firmwares

### 0.10.0 (24.10.2021)

- (HombachC) added sentry.io support

### 0.9.2 (17.10.2021)

- (HombachC) fixed error in charger state feedback

### 0.9.0 (04.10.2021)

- (HombachC) support for firmware 041.0 

### 0.8.0 (09.05.2021)

- (HombachC) added gridphase correction to charge logic

### 0.7.5 (09.05.2021)

- (HombachC) added tests for node.js 16

### 0.7.0 (11.04.2021)

- (HombachC) added measured maximum current 

### 0.6.0 (15.03.2021)

- (HombachC) fix error in foreign state popup

### 0.5.0 (20.12.2020)

- (HombachC) introduces selectable external states for charge control

### 0.4.0 (11.12.2020)

- (HombachC) added use of amx (non persistent set of charge current) to protect hardware (firmware 040 only)

### 0.3.3 (08.12.2020)

- (HombachC) added check of firmware version

### 0.3.2 (08.12.2020)

- (HombachC) bumped dependencies, added poll of firmware version, fixed error in CarStateString

### 0.2.0 (11.09.2020)

- (HombachC) changed type to vehicle

### 0.0.1 (27.06.2020)

- (HombachC) initial release

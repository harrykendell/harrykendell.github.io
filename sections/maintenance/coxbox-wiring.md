# Coxbox Wiring

![Cox box plug front view. Use the keyway to orient the connector. Do not assume pin functions: verify with a multimeter and a known-good device.](imgs/wiring/coxbox_plug.jpg){size=0.5 float=right}

The wiring harness is relatively simple, with 5 pins on the main plug. These are typically split into speakers, rate, and charging pins. Not all pins are used in every connector, so wiring can break out to 2‑pin or 4‑pin plugs where needed.

> [!WARNING] Safety
> Do not test wet connectors. Water + voltage can accelerate corrosion and produce misleading readings.

## Quick reference (typical)

This is a **common** arrangement, not a guarantee:

| Pins | Typical function | Notes |
|---|---|---|
| A–D | Rate switch | Often a reed switch + magnet. Continuity pulses at the catch. |
| B–C | Speakers | Polarity sometimes matters when multiple speakers are used. |
| D–E | Charging / power | Polarity‑sensitive. Verify before connecting power. |

## Troubleshooting

Refer to this document for detailed troubleshooting:

- [NK Coxbox repairs troubleshooting](http://www.redking.me.uk/sport/rowing/equipment/cox_box/nk_repairs.pdf)

[!PROCEDURE:Beginner] Quick connector clean (water ingress prevention)
Clean and dry connectors to prevent corrosion and intermittent failures.

**Tools:** Microfibre, contact cleaner, cotton buds, dielectric grease (optional), adhesive heatshrink (if re‑sealing)

**Steps:**

1. Disconnect and inspect: green/white residue indicates corrosion.
2. Dry fully (no water in the shell).
3. Spray contact cleaner on pins and sockets; wipe residue off.
4. If the connector is exposed to water routinely: re‑seal with adhesive‑lined heatshrink and add strain relief so the connector never takes cable load.
5. Reconnect and test function.

**Check:** Connector is clean, dry, and strain‑relieved. Do monthly and after any “wet boat” outing.
[!/PROCEDURE]

[!PROCEDURE:Intermediate] Quick electrical diagnosis (multimeter)
Troubleshoot non‑working rate, speakers, or charging by testing for continuity and proper voltage on the main connector pins.

> [!WARNING] Important
> Do not test wet connectors.

**Tools:** Multimeter, contact cleaner

**Steps:**

1. Dry connector; inspect for corrosion.
2. **Rate (example):** A–D should connect to a magnet switch. Manually shorting A–D periodically should show stroke rate.
3. **Speakers (example):** B–C should read as a load/short when speakers are wired.
4. **Charging (example):** D–E should read ~13.5–15 V from charger (where applicable).
5. If readings are wrong: isolate which segment is broken by testing continuity section‑by‑section.

**Check:** Values consistent; if not, locate break by testing each segment.
[!/PROCEDURE]

## Parts and sourcing

Harness components are sold at significant markup by NK Sports, Oarsport, etc. The connectors appear to be based on the [Amphenol 44 series](https://www.amphenol-sine.com/pdf/catalog/44-Series.pdf).

**Components (club standard example):**

- Coxbox plug: [044-104-10004-02](https://www.mouser.co.uk/ProductDetail/Amphenol-SINE-Systems/044-104-10004-02?qs=tA%252Bq7m13GXUySe5HIfp6fg%3D%3D)
- 2-pin plugs: [044-103-10002](https://www.mouser.co.uk/ProductDetail/Amphenol-SINE-Systems/044-103-10002?qs=tA%252Bq7m13GXW6faQI3kLxYw%3D%3D), [044-104-10002-02](https://www.mouser.co.uk/ProductDetail/Amphenol-SINE-Systems/044-104-10002-02?qs=tA%252Bq7m13GXWv2d8caGUzFQ%3D%3D)
- Crimps: [044-100-1414P-100-101](https://www.mouser.co.uk/c/?q=044%20100%201414P%20100%20101), [044-102-1414S-100-101](https://www.mouser.co.uk/c/?q=044%20102%201414S%20100%20101)
- Heat shrink: [DWFR-6/2-0-STK](https://www.mouser.co.uk/ProductDetail/TE-Connectivity-Raychem/DWFR-6-2-0-STK?qs=YeFsEeYZIJnMEfWsJKC2lA%3D%3D), [DWFR-16/4-0-STK](https://www.mouser.co.uk/ProductDetail/TE-Connectivity-Raychem/DWFR-16-4-0-STK?qs=YeFsEeYZIJkJLuipLRO0CA%3D%3D)

**Suitable cable types:**

- [H07RN-F 1.5 mm² rubber flex](https://www.cef.co.uk/catalogue/products/2014148-1-5mm-2-core-ho7rnf-rubber-flexible-cable-cut-length-sold-by-the-mtr)
- [YY control cable 1.5 mm²](https://www.cef.co.uk/catalogue/products/4835737-1-5mm-2-core-yy-control-flexible-cable-100m)

## Connector and pinout reference

Coxbox harnesses are only “standard” if **you make them standard**. Pinouts vary by device generation and by what the club has historically wired.

**Rule:** never assume pin functions. Always verify with continuity testing and a known‑good device.

- Keep a **master pinout sheet** for each device type (CoxBox, SpeedCoach, amplifier, etc.) and each boat harness.
- Label both ends of every cable with: boat ID, device type, and revision/date.
- Add strain relief so the connector never carries cable load.

### Pin numbering

For Amphenol Sine Systems 44 Series (common on rowing electronics), use the manufacturer diagram for pin numbering and keying:

- [44 Series catalog](https://www.amphenol-sine.com/pdf/catalog/44-Series.pdf)

### Pinout template (fill in for your club standard)

| Connector | Pin | Function | Wire colour | Notes |
|---|---:|---|---|---|
| Boat harness (to coxbox) | A |  |  |  |
| Boat harness (to coxbox) | B |  |  |  |
| Boat harness (to coxbox) | C |  |  |  |
| Boat harness (to coxbox) | D |  |  |  |
| Boat harness (to coxbox) | E |  |  |  |

### Polarity and shielding notes

- **Audio/speaker** lines are often polarity‑insensitive, but keeping polarity consistent avoids phase issues when multiple speakers are used.
- **Power** lines are polarity‑sensitive: fuse appropriately and protect against shorts.
- For long runs in wet boats, prefer a **jacketed cable** and seal every transition with adhesive‑lined heatshrink.

## Related

- See **[Harness build and repair](/#repairs/coxbox-wiring)** for the build/repair procedure.

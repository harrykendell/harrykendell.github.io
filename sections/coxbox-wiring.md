# Coxbox wiring and boat harnesses

<figure class="figure figure--float-right">
  <img src="imgs/coxbox_plug.jpg" alt="Close-up of a coxbox plug showing pin layout" />
  <div class="figure-body">
    <p class="figure-title">Pin allocation of a coxbox plug</p>
    <!-- <p class="figure-caption">
      Match the pin numbering and keyway orientation shown here when assembling new harnesses or replacing plugs.
    </p> -->
  </div>
</figure>

The wiring harness is relatively simple, with 5 pins on the main plug. These are split into speakers, rate, and charging pins. Not all pins are used in every connector, so wiring can break out to 2-pin or 4-pin plugs where needed.

## Troubleshooting

Refer to this document for detailed troubleshooting:

- [NK Coxbox repairs troubleshooting](http://www.redking.me.uk/sport/rowing/equipment/cox_box/nk_repairs.pdf)

[!PROCEDURE:Intermediate]] Quick electrical diagnosis (multimeter)
Troubleshoot non-working rate, speakers, or charging by testing for continuity and proper voltage on the main connector pins. Do not test wet connectors.

**Tools:** Multimeter, contact cleaner

**Steps:**

1. Dry connector; inspect for corrosion.
2. **Rate:** A–D should connect to a magnet switch. Manually shorting A–D periodically should show stroke rate.
3. **Speakers:** C–B should read as a load/short when speakers are wired.
4. **Charging:** D–E should read ~13.5–15 V from charger (where applicable).

**Check:** Values consistent; if not, locate break by testing each segment. Do when rate/speakers/charging do not work.
[!/PROCEDURE]

## Parts and sourcing

Harness components are sold at significant markup by NK Sports, Oarsport, etc. The connectors appear to be based on the [Amphenol 44 series](https://www.amphenol-sine.com/pdf/catalog/44-Series.pdf).

**Components (club standard):**

- Coxbox plug: [044-104-10004-02](https://www.mouser.co.uk/ProductDetail/Amphenol-SINE-Systems/044-104-10004-02?qs=tA%252Bq7m13GXUySe5HIfp6fg%3D%3D)
- 2-pin plugs: [044-103-10002](https://www.mouser.co.uk/ProductDetail/Amphenol-SINE-Systems/044-103-10002?qs=tA%252Bq7m13GXW6faQI3kLxYw%3D%3D), [044-104-10002-02](https://www.mouser.co.uk/ProductDetail/Amphenol-SINE-Systems/044-104-10002-02?qs=tA%252Bq7m13GXWv2d8caGUzFQ%3D%3D)
- Crimps: [044-100-1414P-100-101](https://www.mouser.co.uk/c/?q=044%20100%201414P%20100%20101), [044-102-1414S-100-101](https://www.mouser.co.uk/c/?q=044%20102%201414S%20100%20101)
- Heat shrink: [DWFR-6/2-0-STK](https://www.mouser.co.uk/ProductDetail/TE-Connectivity-Raychem/DWFR-6-2-0-STK?qs=YeFsEeYZIJnMEfWsJKC2lA%3D%3D), [DWFR-16/4-0-STK](https://www.mouser.co.uk/ProductDetail/TE-Connectivity-Raychem/DWFR-16-4-0-STK?qs=YeFsEeYZIJkJLuipLRO0CA%3D%3D)

Suitable cable types:

- [H07RN-F 1.5 mm² rubber flex](https://www.cef.co.uk/catalogue/products/2014148-1-5mm-2-core-ho7rnf-rubber-flexible-cable-cut-length-sold-by-the-mtr)
- [YY control cable 1.5 mm²](https://www.cef.co.uk/catalogue/products/4835737-1-5mm-2-core-yy-control-flexible-cable-100m)

## Connector and pinout reference

Coxbox harnesses are only “standard” if **you make them standard**. Pinouts vary by device generation and by what the club has historically wired.

**Rule:** never assume pin functions. Always verify with continuity testing and a known-good device.

- Keep a **master pinout sheet** for each device type (CoxBox, SpeedCoach, amplifier, etc.) and each boat harness.
- Label both ends of every cable with: boat ID, device type, and revision/date.
- Add strain relief so the connector never carries cable load.

### Pin numbering

For Amphenol Sine Systems 44 Series (common on rowing electronics), use the manufacturer diagram for pin numbering and keying:

- [44 Series catalog](https://www.amphenol-sine.com/pdf/catalog/44-Series.pdf)

### Pinout template (fill in for your club standard)

| Connector | Pin | Function | Wire colour | Notes |
|---|---:|---|---|---|
| Boat harness (to coxbox) | 1 |  |  |  |
| Boat harness (to coxbox) | 2 |  |  |  |
| Boat harness (to coxbox) | 3 |  |  |  |
| Boat harness (to coxbox) | 4 |  |  |  |

### Polarity and shielding notes

- **Audio/speaker** lines are often polarity-insensitive, but keeping polarity consistent avoids phase issues when multiple speakers are used.
- **Power** lines are polarity-sensitive: fuse appropriately and protect against shorts.
- For long runs in wet boats, prefer a **jacketed cable** and seal every transition with adhesive-lined heatshrink.

## Harness build/repair procedure

[!PROCEDURE:Advanced]] Build or repair a harness segment
Build a new or repair a damaged boat harness to restore electrical continuity and seal against water ingress. Ensure correct keying and pinout; poor strain relief causes repeat failures. Exposed conductors in cockpit or corroded connector pins: stop-use.

**Tools:** Correct crimper, contacts, housings, adhesive-lined heatshrink, heat gun, continuity tester

**Steps:**

1. Cut back to clean, undamaged cable.
2. Strip jacket and conductors to specified length.
3. Crimp contacts (pull test each).
4. Insert into housing following pinout and keyway orientation.
5. Add adhesive-lined heatshrink for strain relief and sealing.
6. Continuity test end-to-end; then functional test with coxbox/speakers.

**Check:** Correct pinout; no shorts between pins; mechanical strain relief effective. This is professional work - mistakes can cause safety failures.

> [!WARNING] Stop-use criteria (electronics)
>
> - Exposed conductors in the cockpit.
> - Connector pins corroded to the point of overheating or intermittent contact.
[!/PROCEDURE]

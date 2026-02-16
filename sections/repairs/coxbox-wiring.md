# Harness build and repair

<figure class="figure figure-float-right">
  <img src="imgs/wiring/harness_build.svg" alt="Diagram showing cable jacket, adhesive heatshrink, crimp contacts, and connector housing with strain relief." />
  <div class="figure-body">
    <p class="figure-title">Seal + strain relief prevents repeat failures</p>
    <p class="figure-caption">
      Most harness failures are not electrical—they are mechanical: water ingress at the connector and broken conductors at the strain point.
    </p>
  </div>
</figure>

This page covers the practical build/repair of rowing electronics harnesses (coxbox, speakers, rate switches, charging).

> [!WARNING] Safety
> Incorrect pinout can damage equipment. Never assume historical wiring matches a “typical” diagram—verify before connecting power.

## Harness build/repair procedure

[!PROCEDURE:Intermediate] Build or rebuild a harness segment (crimp + seal)
Build a new harness segment or rebuild a failed end by cutting back to sound cable, re‑terminating, sealing, and testing.

**Tools:** Wire cutters/strippers, correct crimp tool for contacts, multimeter, contact cleaner, adhesive‑lined heatshrink, labels

**Steps:**

1. **Identify the standard for this device and boat:**
   - Use the club pinout sheet for that device (or create one by mapping a known‑good harness).
2. **Cut back to sound cable:**
   - Remove the failed end and any green/black corrosion in the copper.
3. **Prep conductors:**
   - Strip to the correct length for the contact.
   - If using shield/drain wire, prepare per your standard.
4. **Crimp contacts:**
   - Crimp using the correct die.
   - Perform a light pull test on each conductor.
5. **Assemble connector:**
   - Insert contacts into the housing by pin position; verify each one clicks/locks.
   - Add a secondary lock if the connector uses one.
6. **Seal and strain‑relieve:**
   - Apply adhesive‑lined heatshrink over the cable/connector transition.
   - Ensure the connector housing does not carry cable load.
7. **Label:**
   - Boat ID, device type, revision/date.
8. **Test:**
   - Continuity from end-to-end for each pin.
   - No shorts between pins.
   - If power pins exist: verify polarity with a known‑good reference before connecting to equipment.
9. **Wet‑proofing check (optional):**
   - Confirm sealing at transitions; any exposed braid must be sealed.

**Check:** Passes continuity and short checks; strain relieved; pinout matches standard; labeled.
[!/PROCEDURE]

[!PROCEDURE:Intermediate] Find a break in an installed harness (section test)
Locate intermittent faults by splitting the harness into sections and testing continuity under flex.

**Tools:** Multimeter, known‑good connector/adapters, tape/labels

**Steps:**

1. Identify logical sections (boat harness, seat harness, speaker pigtail, rate sensor pigtail).
2. Test each section for continuity on each conductor.
3. Flex the cable near strain points while testing to find intermittent opens.
4. Once the failing section is identified, rebuild that end using the harness rebuild procedure.

**Check:** Fault isolated to a specific segment and repaired/replaced.
[!/PROCEDURE]

## Related

- For connector reference and troubleshooting, see **[Coxbox wiring](/#maintenance/coxbox-wiring)**.

import pptxgen from 'pptxgenjs';

/**
 * Generates and downloads a beautifully styled, simple, and intuitive PowerPoint presentation (.pptx)
 * explaining the Logistics Payload & Route Optimization app and its Excel outputs.
 */
export async function generateAppPresentation(): Promise<void> {
  const pres = new pptxgen();

  // Configure presentation metadata & widescreen 16:9 format
  pres.layout = 'LAYOUT_16x9';
  pres.title = 'Logistics Payload & Route Optimization Guide';
  pres.subject = 'Simple guide to truck loading, distance matrix, and route planning';
  pres.author = 'Logistics Optimization Team';

  // Shape helpers with type bypass
  const presAny = pres as any;
  const SHAPES = {
    RECT: presAny.ShapeType?.rect || presAny.shapes?.RECTANGLE || 'rect',
    ROUND_RECT: presAny.ShapeType?.roundRect || presAny.shapes?.ROUNDED_RECTANGLE || 'roundRect',
    LINE: presAny.ShapeType?.line || presAny.shapes?.LINE || 'line',
    OVAL: presAny.ShapeType?.oval || presAny.shapes?.OVAL || 'oval',
  };

  // Define sophisticated theme palette
  const COLORS = {
    NAVY: '0F172A',
    SKY: '0284C7',
    CYAN: '0EA5E9',
    LIGHT_BG: 'F8FAFC',
    CARD_BG: 'FFFFFF',
    TEXT_DARK: '1E293B',
    TEXT_MUTED: '64748B',
    GREEN: '16A34A',
    AMBER: 'D97706',
    PURPLE: '7C3AED',
    BORDER: 'CBD5E1',
    WHITE: 'FFFFFF',
  };

  // Helper for slide header
  const addSlideHeader = (
    slide: any,
    slideNum: string,
    title: string,
    subtitle: string
  ) => {
    // Top banner
    slide.addShape(SHAPES.RECT, {
      x: 0,
      y: 0,
      w: 13.33,
      h: 1.1,
      fill: { color: COLORS.NAVY },
    });

    // Pill badge for slide number
    slide.addShape(SHAPES.ROUND_RECT, {
      x: 0.6,
      y: 0.22,
      w: 1.1,
      h: 0.35,
      rectRadius: 0.05,
      fill: { color: COLORS.CYAN },
    });

    slide.addText(slideNum, {
      x: 0.6,
      y: 0.22,
      w: 1.1,
      h: 0.35,
      fontSize: 11,
      fontFace: 'Arial',
      bold: true,
      color: COLORS.NAVY,
      align: 'center',
      valign: 'middle',
    });

    // Title
    slide.addText(title, {
      x: 1.9,
      y: 0.15,
      w: 10.8,
      h: 0.45,
      fontSize: 18,
      fontFace: 'Arial',
      bold: true,
      color: COLORS.WHITE,
      valign: 'middle',
    });

    // Subtitle
    slide.addText(subtitle, {
      x: 1.9,
      y: 0.6,
      w: 10.8,
      h: 0.35,
      fontSize: 11,
      fontFace: 'Arial',
      color: '94A3B8',
      valign: 'middle',
    });
  };

  // Helper for slide footer
  const addSlideFooter = (slide: any) => {
    slide.addShape(SHAPES.LINE, {
      x: 0.6,
      y: 7.05,
      w: 12.13,
      h: 0,
      line: { color: COLORS.BORDER, width: 1 },
    });

    slide.addText('Logistics Payload & Route Optimization Engine  •  Simple User Guide', {
      x: 0.6,
      y: 7.1,
      w: 9.0,
      h: 0.3,
      fontSize: 9,
      fontFace: 'Arial',
      color: COLORS.TEXT_MUTED,
    });

    slide.addText('Strictly Confidential & Internal Use', {
      x: 9.5,
      y: 7.1,
      w: 3.23,
      h: 0.3,
      fontSize: 9,
      fontFace: 'Arial',
      color: COLORS.TEXT_MUTED,
      align: 'right',
    });
  };

  // ==========================================
  // SLIDE 1: Problem Overview & Solution Logic
  // ==========================================
  {
    const slide = pres.addSlide();
    addSlideHeader(
      slide,
      'SLIDE 1',
      'The Problem We Are Solving & How the Smart Logic Works',
      'Understanding the logistics challenge and how the app automatically plans full trucks & fast routes'
    );

    // Left Box: The Real Problem (Story)
    slide.addShape(SHAPES.ROUND_RECT, {
      x: 0.6,
      y: 1.35,
      w: 5.8,
      h: 5.45,
      rectRadius: 0.1,
      fill: { color: COLORS.CARD_BG },
      line: { color: COLORS.BORDER, width: 1.5 },
    });

    slide.addShape(SHAPES.ROUND_RECT, {
      x: 0.8,
      y: 1.55,
      w: 5.4,
      h: 0.45,
      rectRadius: 0.05,
      fill: { color: 'FEE2E2' },
    });

    slide.addText('🚨 The Big Challenge Every Morning', {
      x: 0.9,
      y: 1.55,
      w: 5.2,
      h: 0.45,
      fontSize: 12,
      fontFace: 'Arial',
      bold: true,
      color: '991B1B',
      valign: 'middle',
    });

    const problemPoints = [
      { text: 'You receive hundreds of orders for different cities every day.\n', options: { bold: false } },
      { text: '❌ Sending half-empty trucks ', options: { bold: true, color: '991B1B' } },
      { text: 'wastes money on fuel and drivers.\n\n', options: { bold: false } },
      { text: '❌ Overloading a truck ', options: { bold: true, color: '991B1B' } },
      { text: 'breaks highway safety laws.\n\n', options: { bold: false } },
      { text: '❌ Visiting cities in the wrong order ', options: { bold: true, color: '991B1B' } },
      { text: 'delays deliveries and makes customers unhappy!\n\n', options: { bold: false } },
      { text: '🎯 The Goal: ', options: { bold: true, color: COLORS.NAVY } },
      { text: 'Pack customer orders into full 25 MT, 30 MT, or 35 MT trucks and find the shortest road routes automatically!', options: { bold: false } },
    ];

    slide.addText(problemPoints, {
      x: 0.8,
      y: 2.15,
      w: 5.4,
      h: 4.4,
      fontSize: 11,
      fontFace: 'Arial',
      color: COLORS.TEXT_DARK,
      valign: 'top',
    });

    // Right Box: The 3-Step Solution Flow
    slide.addShape(SHAPES.ROUND_RECT, {
      x: 6.7,
      y: 1.35,
      w: 6.0,
      h: 5.45,
      rectRadius: 0.1,
      fill: { color: 'F0FDF4' },
      line: { color: '86EFAC', width: 1.5 },
    });

    slide.addShape(SHAPES.ROUND_RECT, {
      x: 6.9,
      y: 1.55,
      w: 5.6,
      h: 0.45,
      rectRadius: 0.05,
      fill: { color: 'DCFCE7' },
    });

    slide.addText('✨ The 3-Step Smart Solution (Aggregation)', {
      x: 7.0,
      y: 1.55,
      w: 5.4,
      h: 0.45,
      fontSize: 12,
      fontFace: 'Arial',
      bold: true,
      color: COLORS.GREEN,
      valign: 'middle',
    });

    // Step 1 Card
    slide.addShape(SHAPES.ROUND_RECT, {
      x: 6.9,
      y: 2.15,
      w: 5.6,
      h: 1.3,
      rectRadius: 0.08,
      fill: { color: COLORS.WHITE },
      line: { color: COLORS.BORDER, width: 1 },
    });
    slide.addText('Step 1: Real Road Map Distance (Tab 1)', {
      x: 7.1,
      y: 2.25,
      w: 5.2,
      h: 0.3,
      fontSize: 11,
      fontFace: 'Arial',
      bold: true,
      color: COLORS.SKY,
    });
    slide.addText('Measures exact road driving distances (km) and travel times between every customer location, just like a GPS navigator.', {
      x: 7.1,
      y: 2.55,
      w: 5.2,
      h: 0.8,
      fontSize: 9.5,
      fontFace: 'Arial',
      color: COLORS.TEXT_DARK,
    });

    // Step 2 Card
    slide.addShape(SHAPES.ROUND_RECT, {
      x: 6.9,
      y: 3.55,
      w: 5.6,
      h: 1.45,
      rectRadius: 0.08,
      fill: { color: COLORS.WHITE },
      line: { color: COLORS.BORDER, width: 1 },
    });
    slide.addText('Step 2: Smart Truck Packing (Tab 2)', {
      x: 7.1,
      y: 3.65,
      w: 5.2,
      h: 0.3,
      fontSize: 11,
      fontFace: 'Arial',
      bold: true,
      color: COLORS.PURPLE,
    });
    slide.addText('Groups orders going to the same or neighbor cities together. Packs standard trucks (25 MT, 30 MT, 35 MT) until they are >85% full to eliminate wasted trips.', {
      x: 7.1,
      y: 3.95,
      w: 5.2,
      h: 0.95,
      fontSize: 9.5,
      fontFace: 'Arial',
      color: COLORS.TEXT_DARK,
    });

    // Step 3 Card
    slide.addShape(SHAPES.ROUND_RECT, {
      x: 6.9,
      y: 5.1,
      w: 5.6,
      h: 1.45,
      rectRadius: 0.08,
      fill: { color: COLORS.WHITE },
      line: { color: COLORS.BORDER, width: 1 },
    });
    slide.addText('Step 3: Best Delivery Sequence & Deadlines', {
      x: 7.1,
      y: 5.2,
      w: 5.2,
      h: 0.3,
      fontSize: 11,
      fontFace: 'Arial',
      bold: true,
      color: COLORS.GREEN,
    });
    slide.addText('Sequences stops in order (Stop 1 ➔ Stop 2 ➔ Stop 3) so drivers never double-back, while ensuring deliveries arrive before customer SLA deadlines.', {
      x: 7.1,
      y: 5.5,
      w: 5.2,
      h: 0.95,
      fontSize: 9.5,
      fontFace: 'Arial',
      color: COLORS.TEXT_DARK,
    });

    addSlideFooter(slide);
  }

  // ==========================================
  // SLIDE 2: How to Use Tab 1 Across Buttons
  // ==========================================
  {
    const slide = pres.addSlide();
    addSlideHeader(
      slide,
      'SLIDE 2',
      'How to Use Tab 1 (Distance Matrix Engine)',
      'Step-by-step guide on what each button does on the Distance Matrix screen'
    );

    slide.addShape(SHAPES.ROUND_RECT, {
      x: 0.6,
      y: 1.3,
      w: 12.13,
      h: 0.7,
      rectRadius: 0.05,
      fill: { color: 'F1F5F9' },
      line: { color: COLORS.BORDER, width: 1 },
    });

    slide.addText('1. Upload Sales Register  ➔  2. Click "Evaluate Distance"  ➔  3. Inspect Matrix Grid  ➔  4. Export .XLSX', {
      x: 0.8,
      y: 1.3,
      w: 11.73,
      h: 0.7,
      fontSize: 11.5,
      fontFace: 'Arial',
      bold: true,
      color: COLORS.NAVY,
      align: 'center',
      valign: 'middle',
    });

    const buttons = [
      {
        num: '1',
        title: 'Sales Register Attachment Box',
        desc: 'Drag & drop your daily order Excel file here.\nThe app reads all customer names, cities, and GPS coordinates automatically.',
        tag: 'First Action',
        tagColor: '0284C7',
        tagBg: 'E0F2FE',
        y: 2.15,
      },
      {
        num: '2',
        title: 'Evaluate distance for uploaded file',
        desc: 'The Magic Button! Triggers the computer to evaluate real road driving distances (in km) and travel time (in minutes) for all customer pairs.',
        tag: 'Main Evaluation',
        tagColor: '16A34A',
        tagBg: 'DCFCE7',
        y: 3.35,
      },
      {
        num: '3',
        title: 'Sample Matrix Template for Upload',
        desc: 'Downloads a ready-made blank Excel sheet template showing the exact column format if you ever need to prepare distances manually.',
        tag: 'Template Download',
        tagColor: '7C3AED',
        tagBg: 'F3E8FF',
        y: 4.55,
      },
      {
        num: '4',
        title: 'Upload Distance Matrix & Grid Edit',
        desc: 'Upload an existing pre-calculated distance file, or click any cell in the live table grid to manually change a distance if a road is blocked.',
        tag: 'Custom Upload / Override',
        tagColor: 'D97706',
        tagBg: 'FEF3C7',
        y: 5.75,
      },
    ];

    buttons.forEach((b) => {
      slide.addShape(SHAPES.ROUND_RECT, {
        x: 0.6,
        y: b.y,
        w: 12.13,
        h: 1.05,
        rectRadius: 0.08,
        fill: { color: COLORS.CARD_BG },
        line: { color: COLORS.BORDER, width: 1.2 },
      });

      slide.addShape(SHAPES.OVAL, {
        x: 0.8,
        y: b.y + 0.15,
        w: 0.75,
        h: 0.75,
        fill: { color: COLORS.NAVY },
      });

      slide.addText(b.num, {
        x: 0.8,
        y: b.y + 0.15,
        w: 0.75,
        h: 0.75,
        fontSize: 14,
        fontFace: 'Arial',
        bold: true,
        color: COLORS.WHITE,
        align: 'center',
        valign: 'middle',
      });

      slide.addText(b.title, {
        x: 1.7,
        y: b.y + 0.15,
        w: 6.5,
        h: 0.35,
        fontSize: 12,
        fontFace: 'Arial',
        bold: true,
        color: COLORS.NAVY,
      });

      slide.addShape(SHAPES.ROUND_RECT, {
        x: 9.8,
        y: b.y + 0.18,
        w: 2.7,
        h: 0.32,
        rectRadius: 0.04,
        fill: { color: b.tagBg },
      });

      slide.addText(b.tag, {
        x: 9.8,
        y: b.y + 0.18,
        w: 2.7,
        h: 0.32,
        fontSize: 9.5,
        fontFace: 'Arial',
        bold: true,
        color: b.tagColor,
        align: 'center',
        valign: 'middle',
      });

      slide.addText(b.desc, {
        x: 1.7,
        y: b.y + 0.5,
        w: 10.5,
        h: 0.5,
        fontSize: 9.5,
        fontFace: 'Arial',
        color: COLORS.TEXT_MUTED,
      });
    });

    addSlideFooter(slide);
  }

  // ==========================================
  // SLIDE 3: Explaining Tab 1 Output Excel File
  // ==========================================
  {
    const slide = pres.addSlide();
    addSlideHeader(
      slide,
      'SLIDE 3',
      'Understanding the Tab 1 Output Excel File (distanceMatrix.xlsx)',
      'A simple explanation of the 3 sheets generated when you export the distance matrix'
    );

    const sheets = [
      {
        name: 'Sheet 1: Distance Matrix (km)',
        badge: 'The Mileage Grid',
        badgeColor: '0284C7',
        badgeBg: 'E0F2FE',
        desc: 'A square grid chart that works just like a road atlas table:',
        bullets: [
          '• Left Rows: Origin city where the trip starts.',
          '• Top Columns: Destination city where the trip ends.',
          '• Inside Cells: Driving distance in kilometers (km).',
          '• Example: Row "Guwahati" + Column "Silchar" = 312.4 km.',
        ],
        x: 0.6,
      },
      {
        name: 'Sheet 2: Pairwise Distances',
        badge: 'Full Route Breakdown',
        badgeColor: '16A34A',
        badgeBg: 'DCFCE7',
        desc: 'A detailed line-by-line list of every city combination:',
        bullets: [
          '• From Location & GPS Lat/Lon (Start point).',
          '• To Location & GPS Lat/Lon (End point).',
          '• Distance (km): Exact road mileage.',
          '• Est. Duration (min): Estimated driving time.',
          '• Calculation Tier: Verified road engine vs. fallback.',
        ],
        x: 4.8,
      },
      {
        name: 'Sheet 3: Location Directory',
        badge: 'Master City Index',
        badgeColor: '7C3AED',
        badgeBg: 'F3E8FF',
        desc: 'Summary of all unique destinations found in your sales file:',
        bullets: [
          '• Total Unique Destinations (N count).',
          '• Total Combinations Calculated (N × N pairs).',
          '• Clean list of GPS coordinates per location.',
          '• Verification stamp that matrix is 100% complete.',
        ],
        x: 9.0,
      },
    ];

    sheets.forEach((s) => {
      slide.addShape(SHAPES.ROUND_RECT, {
        x: s.x,
        y: 1.35,
        w: 3.73,
        h: 5.45,
        rectRadius: 0.1,
        fill: { color: COLORS.CARD_BG },
        line: { color: COLORS.BORDER, width: 1.5 },
      });

      slide.addShape(SHAPES.ROUND_RECT, {
        x: s.x + 0.2,
        y: 1.55,
        w: 3.33,
        h: 0.6,
        rectRadius: 0.05,
        fill: { color: COLORS.NAVY },
      });

      slide.addText(s.name, {
        x: s.x + 0.25,
        y: 1.55,
        w: 3.23,
        h: 0.6,
        fontSize: 10.5,
        fontFace: 'Arial',
        bold: true,
        color: COLORS.WHITE,
        align: 'center',
        valign: 'middle',
      });

      slide.addShape(SHAPES.ROUND_RECT, {
        x: s.x + 0.6,
        y: 2.25,
        w: 2.53,
        h: 0.3,
        rectRadius: 0.04,
        fill: { color: s.badgeBg },
      });

      slide.addText(s.badge, {
        x: s.x + 0.6,
        y: 2.25,
        w: 2.53,
        h: 0.3,
        fontSize: 9.5,
        fontFace: 'Arial',
        bold: true,
        color: s.badgeColor,
        align: 'center',
        valign: 'middle',
      });

      slide.addText(s.desc, {
        x: s.x + 0.25,
        y: 2.65,
        w: 3.23,
        h: 0.6,
        fontSize: 9.5,
        fontFace: 'Arial',
        bold: true,
        color: COLORS.TEXT_DARK,
      });

      slide.addText(s.bullets.join('\n\n'), {
        x: s.x + 0.25,
        y: 3.3,
        w: 3.23,
        h: 3.3,
        fontSize: 9,
        fontFace: 'Arial',
        color: COLORS.TEXT_MUTED,
        valign: 'top',
      });
    });

    addSlideFooter(slide);
  }

  // ==========================================
  // SLIDE 4: How to Use Tab 2 Across Buttons
  // ==========================================
  {
    const slide = pres.addSlide();
    addSlideHeader(
      slide,
      'SLIDE 4',
      'How to Use Tab 2 (Payload & Route Optimization)',
      'Step-by-step guide to generating full truck loads and sequenced delivery routes'
    );

    slide.addShape(SHAPES.ROUND_RECT, {
      x: 0.6,
      y: 1.35,
      w: 6.5,
      h: 5.45,
      rectRadius: 0.1,
      fill: { color: COLORS.CARD_BG },
      line: { color: COLORS.BORDER, width: 1.5 },
    });

    slide.addShape(SHAPES.ROUND_RECT, {
      x: 0.8,
      y: 1.55,
      w: 6.1,
      h: 0.45,
      rectRadius: 0.05,
      fill: { color: 'E0F2FE' },
    });

    slide.addText('🕹️ Key Settings & Optimization Triggers', {
      x: 0.9,
      y: 1.55,
      w: 5.9,
      h: 0.45,
      fontSize: 12,
      fontFace: 'Arial',
      bold: true,
      color: COLORS.SKY,
      valign: 'middle',
    });

    const tab2Steps = [
      {
        num: 'A',
        title: 'Select Origin Depot',
        text: 'Pick where your trucks start from (e.g., Guwahati Central Depot). All trip kilometers start and end from here.',
      },
      {
        num: 'B',
        title: 'Choose Vehicle Sizes & Drop Limits',
        text: 'Toggle available truck types (25 MT, 30 MT, 35 MT) and max customer stops allowed per truck (e.g., 3-4 drops).',
      },
      {
        num: 'C',
        title: 'Click "Run Optimization" (Master Action)',
        text: 'The algorithm packs orders into full trucks, sequences the delivery stops, checks customer SLAs, and builds the plan in seconds!',
      },
      {
        num: 'D',
        title: 'Export Dispatch Plan (.XLSX)',
        text: 'Downloads the finalized dispatch workbook with Vehicle IDs and trip manifests ready for loading bay supervisors.',
      },
    ];

    tab2Steps.forEach((s, idx) => {
      const topY = 2.15 + idx * 1.1;
      slide.addShape(SHAPES.OVAL, {
        x: 0.85,
        y: topY + 0.05,
        w: 0.5,
        h: 0.5,
        fill: { color: COLORS.NAVY },
      });
      slide.addText(s.num, {
        x: 0.85,
        y: topY + 0.05,
        w: 0.5,
        h: 0.5,
        fontSize: 11,
        fontFace: 'Arial',
        bold: true,
        color: COLORS.WHITE,
        align: 'center',
        valign: 'middle',
      });
      slide.addText(s.title, {
        x: 1.45,
        y: topY,
        w: 5.4,
        h: 0.3,
        fontSize: 10.5,
        fontFace: 'Arial',
        bold: true,
        color: COLORS.NAVY,
      });
      slide.addText(s.text, {
        x: 1.45,
        y: topY + 0.28,
        w: 5.4,
        h: 0.65,
        fontSize: 9,
        fontFace: 'Arial',
        color: COLORS.TEXT_MUTED,
      });
    });

    slide.addShape(SHAPES.ROUND_RECT, {
      x: 7.4,
      y: 1.35,
      w: 5.33,
      h: 5.45,
      rectRadius: 0.1,
      fill: { color: 'F8FAFC' },
      line: { color: COLORS.BORDER, width: 1.5 },
    });

    slide.addShape(SHAPES.ROUND_RECT, {
      x: 7.6,
      y: 1.55,
      w: 4.93,
      h: 0.45,
      rectRadius: 0.05,
      fill: { color: 'DCFCE7' },
    });

    slide.addText('👀 What You See on Screen After Running', {
      x: 7.7,
      y: 1.55,
      w: 4.73,
      h: 0.45,
      fontSize: 12,
      fontFace: 'Arial',
      bold: true,
      color: COLORS.GREEN,
      valign: 'middle',
    });

    const screenFeatures = [
      {
        title: '🗺️ Interactive Route Map',
        desc: 'Color-coded lines show exactly where each truck travels from the depot through customer stops 1, 2, and 3.',
      },
      {
        title: '📊 Fleet KPI Cards',
        desc: 'Shows Total Trucks Needed, Average Fill Rate (>90%), Total Weight Dispatched, and Total Kilometers.',
      },
      {
        title: '📋 Order Allocation Table',
        desc: 'Every customer order is tagged with its assigned Vehicle ID (e.g., 25MT_1) or marked as Backlog if too small.',
      },
      {
        title: '⏱️ Delivery SLA Status',
        desc: 'Green tags indicate on-time arrival. Red tags highlight tight deadlines or potential delays.',
      },
    ];

    screenFeatures.forEach((f, idx) => {
      const topY = 2.15 + idx * 1.1;
      slide.addShape(SHAPES.ROUND_RECT, {
        x: 7.6,
        y: topY,
        w: 4.93,
        h: 0.95,
        rectRadius: 0.06,
        fill: { color: COLORS.WHITE },
        line: { color: COLORS.BORDER, width: 1 },
      });
      slide.addText(f.title, {
        x: 7.75,
        y: topY + 0.08,
        w: 4.63,
        h: 0.28,
        fontSize: 10,
        fontFace: 'Arial',
        bold: true,
        color: COLORS.NAVY,
      });
      slide.addText(f.desc, {
        x: 7.75,
        y: topY + 0.35,
        w: 4.63,
        h: 0.55,
        fontSize: 8.5,
        fontFace: 'Arial',
        color: COLORS.TEXT_MUTED,
      });
    });

    addSlideFooter(slide);
  }

  // ==========================================
  // SLIDE 5: Explaining Tab 2 Output Excel File
  // ==========================================
  {
    const slide = pres.addSlide();
    addSlideHeader(
      slide,
      'SLIDE 5',
      'Understanding the Tab 2 Output Excel File (Dispatch Plan)',
      'A simple explanation of the 4 sheets inside the final dispatch plan workbook'
    );

    const sheetsTab2 = [
      {
        name: 'Sheet 1: Enriched Orders & Allocation',
        tag: 'Master Order Sheet',
        tagColor: '0284C7',
        tagBg: 'E0F2FE',
        bullets: [
          '• Contains all original sales orders with 2 NEW columns at the end:',
          '  - Vehicle Type Allotted (25 MT, 30 MT, 35 MT, or NA).',
          '  - Vehicle ID (e.g. 25MT_1 means 25 MT Truck #1).',
          '• Tells you exactly which truck carries which customer order.',
        ],
        x: 0.6,
        y: 1.35,
      },
      {
        name: 'Sheet 2: Fleet Summary',
        tag: 'Manager KPI Dashboard',
        tagColor: '16A34A',
        tagBg: 'DCFCE7',
        bullets: [
          '• Quick one-page executive summary for operations leaders:',
          '  - How many 25 MT, 30 MT, and 35 MT trucks are needed today.',
          '  - Total trucks required & Total tonnage dispatched.',
          '  - Average fleet capacity utilization (e.g., 94.5% full).',
        ],
        x: 6.8,
        y: 1.35,
      },
      {
        name: 'Sheet 3: Vehicle Manifest & Stops',
        tag: 'Driver & Bay Trip Sheet',
        tagColor: '7C3AED',
        tagBg: 'F3E8FF',
        bullets: [
          '• The most important sheet for loading supervisors and drivers:',
          '  - Vehicle ID, rated capacity, actual weight loaded & fill %.',
          '  - Step-by-step route: Stop 1 ➔ Stop 2 ➔ Stop 3.',
          '  - Total trip kilometers & estimated driving duration.',
        ],
        x: 0.6,
        y: 4.15,
      },
      {
        name: 'Sheet 4: Depot Backlog (NA)',
        tag: 'Orders Held for Next Batch',
        tagColor: 'D97706',
        tagBg: 'FEF3C7',
        bullets: [
          '• Lists orders that could not safely fill a full truck today:',
          '  - Example: A tiny 2 MT order with no nearby deliveries.',
          '  - Explains why it was held back so planners can combine it with tomorrow\'s orders without wasting a truck.',
        ],
        x: 6.8,
        y: 4.15,
      },
    ];

    sheetsTab2.forEach((s) => {
      slide.addShape(SHAPES.ROUND_RECT, {
        x: s.x,
        y: s.y,
        w: 5.93,
        h: 2.65,
        rectRadius: 0.08,
        fill: { color: COLORS.CARD_BG },
        line: { color: COLORS.BORDER, width: 1.5 },
      });

      slide.addShape(SHAPES.ROUND_RECT, {
        x: s.x + 0.15,
        y: s.y + 0.15,
        w: 3.6,
        h: 0.38,
        rectRadius: 0.04,
        fill: { color: COLORS.NAVY },
      });

      slide.addText(s.name, {
        x: s.x + 0.2,
        y: s.y + 0.15,
        w: 3.5,
        h: 0.38,
        fontSize: 10,
        fontFace: 'Arial',
        bold: true,
        color: COLORS.WHITE,
        valign: 'middle',
      });

      slide.addShape(SHAPES.ROUND_RECT, {
        x: s.x + 3.85,
        y: s.y + 0.15,
        w: 1.9,
        h: 0.38,
        rectRadius: 0.04,
        fill: { color: s.tagBg },
      });

      slide.addText(s.tag, {
        x: s.x + 3.85,
        y: s.y + 0.15,
        w: 1.9,
        h: 0.38,
        fontSize: 9,
        fontFace: 'Arial',
        bold: true,
        color: s.tagColor,
        align: 'center',
        valign: 'middle',
      });

      slide.addText(s.bullets.join('\n'), {
        x: s.x + 0.2,
        y: s.y + 0.6,
        w: 5.53,
        h: 1.9,
        fontSize: 9,
        fontFace: 'Arial',
        color: COLORS.TEXT_DARK,
        valign: 'top',
      });
    });

    addSlideFooter(slide);
  }

  // Trigger browser download
  await pres.writeFile({ fileName: 'Logistics_Payload_and_Route_Optimizer_Guide.pptx' });
}

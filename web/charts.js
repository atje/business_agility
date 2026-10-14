const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

function createSvgElement(name, attributes = {}) {
  const element = document.createElementNS(SVG_NAMESPACE, name);
  for (const [attribute, value] of Object.entries(attributes)) {
    element.setAttribute(attribute, String(value));
  }
  return element;
}

export function renderScatterChart(svg, {
  points,
  xLabel,
  yLabel,
  ariaLabel,
  emptyMessage = "No data yet",
  width = 760,
  height = 420,
  margin = { top: 22, right: 26, bottom: 64, left: 72 },
  tickCount = 4,
  tickFormat = (value) => value.toFixed(1),
}) {
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const xMax = Math.max(1, ...points.map((point) => point.x)) * 1.1;
  const yMax = Math.max(1, ...points.map((point) => point.y)) * 1.1;
  svg.replaceChildren();
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("aria-label", ariaLabel);

  for (let tick = 0; tick <= tickCount; tick += 1) {
    const fraction = tick / tickCount;
    const x = margin.left + plotWidth * fraction;
    const y = margin.top + plotHeight * (1 - fraction);
    svg.append(
      createSvgElement("line", {
        x1: margin.left,
        x2: width - margin.right,
        y1: y,
        y2: y,
        class: "chart-gridline",
      }),
      createSvgElement("line", {
        x1: x,
        x2: x,
        y1: margin.top,
        y2: height - margin.bottom,
        class: "chart-gridline",
      }),
    );

    const xTick = createSvgElement("text", {
      x,
      y: height - margin.bottom + 22,
      class: "chart-tick",
      "text-anchor": "middle",
    });
    xTick.textContent = tickFormat(xMax * fraction);
    svg.append(xTick);

    const yTick = createSvgElement("text", {
      x: margin.left - 12,
      y: y + 4,
      class: "chart-tick",
      "text-anchor": "end",
    });
    yTick.textContent = tickFormat(yMax * fraction);
    svg.append(yTick);
  }

  svg.append(
    createSvgElement("line", {
      x1: margin.left,
      x2: width - margin.right,
      y1: height - margin.bottom,
      y2: height - margin.bottom,
      class: "chart-axis",
    }),
    createSvgElement("line", {
      x1: margin.left,
      x2: margin.left,
      y1: margin.top,
      y2: height - margin.bottom,
      class: "chart-axis",
    }),
  );

  const horizontalLabel = createSvgElement("text", {
    x: margin.left + plotWidth / 2,
    y: height - 12,
    class: "chart-axis-label",
    "text-anchor": "middle",
  });
  horizontalLabel.textContent = xLabel;
  svg.append(horizontalLabel);

  const verticalLabel = createSvgElement("text", {
    x: 18,
    y: margin.top + plotHeight / 2,
    class: "chart-axis-label",
    "text-anchor": "middle",
    transform: `rotate(-90 18 ${margin.top + plotHeight / 2})`,
  });
  verticalLabel.textContent = yLabel;
  svg.append(verticalLabel);

  for (const dataPoint of points) {
    const x = margin.left + (dataPoint.x / xMax) * plotWidth;
    const y = margin.top + plotHeight - (dataPoint.y / yMax) * plotHeight;
    const point = createSvgElement("circle", {
      cx: x,
      cy: y,
      r: dataPoint.radius ?? 5,
      class: `chart-point${dataPoint.className ? ` ${dataPoint.className}` : ""}`,
      tabindex: 0,
      "aria-label": dataPoint.label,
    });
    const title = createSvgElement("title");
    title.textContent = dataPoint.label;
    point.append(title);
    svg.append(point);

    if (dataPoint.countLabel !== undefined) {
      const countLabel = createSvgElement("text", {
        x,
        y: y + 4,
        class: "chart-point-count",
        "text-anchor": "middle",
        "pointer-events": "none",
      });
      countLabel.textContent = String(dataPoint.countLabel);
      svg.append(countLabel);
    }
  }

  if (!points.length) {
    const empty = createSvgElement("text", {
      x: margin.left + plotWidth / 2,
      y: margin.top + plotHeight / 2,
      class: "chart-empty-state",
      "text-anchor": "middle",
    });
    empty.textContent = emptyMessage;
    svg.append(empty);
  }
}

export function groupTimingRecords(workItemRecords, simulationTime) {
  const groups = new Map();
  for (const workItem of workItemRecords) {
    const leadTime = workItem.completed
      ? workItem.leadTime
      : Math.max(0, simulationTime - workItem.startTime);
    const processingRatio = leadTime > 0 ? workItem.processingTime / leadTime : 0;
    const bucketLeadTime = Number(leadTime.toFixed(1));
    const bucketRatio = Number(processingRatio.toFixed(1));
    const key = `${bucketLeadTime}:${bucketRatio}`;
    let group = groups.get(key);
    if (!group) {
      group = {
        leadTime: bucketLeadTime,
        processingRatio: bucketRatio,
        count: 0,
        completedCount: 0,
      };
      groups.set(key, group);
    }
    group.count += 1;
    if (workItem.completed) group.completedCount += 1;
  }
  return [...groups.values()];
}

export function renderTimingChart(svg, workItemRecords, simulationTime) {
  const groups = groupTimingRecords(workItemRecords, simulationTime);
  const points = groups.map((group) => {
    const statusClass = group.completedCount === group.count
      ? "chart-point-complete"
      : group.completedCount === 0
        ? "chart-point-active"
        : "chart-point-mixed";
    const label = `${group.count} workItem${group.count === 1 ? "" : "s"}: ${group.leadTime.toFixed(1)} lead days, processing-to-lead ratio ${group.processingRatio.toFixed(1)}, ${group.completedCount} completed`;
    return {
      x: group.leadTime,
      y: group.processingRatio,
      radius: 5 + Math.sqrt(group.count) * 4,
      className: statusClass,
      label,
      countLabel: group.count > 1 ? group.count : undefined,
    };
  });

  renderScatterChart(svg, {
    points,
    xLabel: "Lead time (days)",
    yLabel: "Processing time / lead time",
    ariaLabel: `${workItemRecords.length} work items in ${points.length} plotted groups. Lead time in days is on the horizontal axis; processing time divided by lead time is on the vertical axis. Bubble size represents the number of workItems in each group.`,
    emptyMessage: "No workItems yet",
  });
}

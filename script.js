async function createHeatmap() {
    // Accessing data
    const rawData = await d3.csv("dataset/olympics_medals_by_sport_year.csv");

    // --- Data Preprocessing ---
    const processedData = [];
    const medalTypes = ["Gold", "Silver", "Bronze"];

    rawData.forEach(row => {
        medalTypes.forEach(medal => {
            const count = +row[medal];
            const cleanCount = (count !== undefined && !isNaN(count)) ? count : 0;
            // Only add if sport and year are valid, handle potential missing values if needed
            if (row.Sport && row.Year) {
                processedData.push({
                    Sport: row.Sport,
                    Year: +row.Year,
                    Medal: medal,
                    Count: cleanCount,
                    SportMedal: `${row.Sport}-${medal}`
                });
            }
        });
    });

    // Sort the processed data (useful for grouping/stats later)
    processedData.sort((a, b) => {
        if (a.Sport < b.Sport) return -1;
        if (a.Sport > b.Sport) return 1;
        return medalTypes.indexOf(a.Medal) - medalTypes.indexOf(b.Medal);
    });

    // Determining unique domains from the processed data
    // Deriving domains from processedData which contains all sports/years present in the CSV
    const sportsDomain = Array.from(new Set(processedData.map(d => d.Sport))).sort();
    const yearsDomain = Array.from(new Set(processedData.map(d => d.Year))).sort(d3.ascending);

    // Creating the full SportMedal domain based on *all* sports and the fixed medal order
    const sportsMedalsDomain = sportsDomain.flatMap(sport => medalTypes.map(medal => `${sport}-${medal}`));


    // Calculating Min/Max per Sport-Medal category based on actual data
    const sportMedalStats = new Map();
    const groupedBySportMedal = d3.group(processedData, d => d.SportMedal); // Group original data
    groupedBySportMedal.forEach((values, key) => {
        const nonZeroCounts = values.filter(d => d.Count > 0).map(d => d.Count);
        if (nonZeroCounts.length > 0) {
            sportMedalStats.set(key, { min: d3.min(nonZeroCounts), max: d3.max(nonZeroCounts), hasData: true });
        } else {
            // For empty boxes where no data is available
            sportMedalStats.set(key, { min: null, max: null, hasData: false });
        }
    });

    // Create a lookup map for actual counts: Key = "Sport-Medal_Year"
    const countLookup = new Map(processedData.map(d => [`${d.SportMedal}_${d.Year}`, d.Count]));

    // Generate data for all possible cells in the grid
    const allCellsData = [];
    sportsMedalsDomain.forEach(sm => {
        const [sport, medal] = sm.split('-');
        yearsDomain.forEach(yr => {
            const key = `${sm}_${yr}`;
            const count = countLookup.get(key) ?? 0; // Lookup count, default to 0 if key not found

            allCellsData.push({
                SportMedal: sm,
                Year: yr,
                Sport: sport,
                Medal: medal,
                Count: count // Every cell now has a count, even if 0
            });
        });
    });

    // Calculate overall max count from the combined data (or just processedData is fine)
    const maxCount = d3.max(allCellsData, d => d.Count);


    // Creating chart dimensions
    const margin = { top: 80, right: 50, bottom: 60, left: 160 };
    const heatmapDiv = d3.select("#heatmap");

    // Handling potential initial zero width of div before full rendering
    let containerWidth = heatmapDiv.node()?.getBoundingClientRect().width ?? 0;
    if (containerWidth <= 0) {
        containerWidth = Math.min(window.innerWidth * 0.9, 1200); // Fallback based on window size
        console.warn("Heatmap div width calculation fallback used.");
    }
    const width = containerWidth - margin.left - margin.right;
    const rowHeight = 18;

    // Height depends on the full sportsMedalsDomain
    const height = sportsMedalsDomain.length * rowHeight;

    // Draw canvas
    const svg = heatmapDiv
        .append("svg")
        .attr("viewBox", `0 0 ${containerWidth} ${height + margin.top + margin.bottom}`)
        .attr("preserveAspectRatio", "xMidYMid meet")
        .append("g")
        .attr("transform", `translate(${margin.left}, ${margin.top})`);

    // Creating scales (Domains based on *all* sports/years/medals)
    const xScale = d3.scaleBand().domain(yearsDomain).range([0, width]).paddingInner(0.05).paddingOuter(0.1);
    const yScale = d3.scaleBand().domain(sportsMedalsDomain).range([0, height]).paddingInner(0.1).paddingOuter(0.05);
    const colorScale = d3.scaleSequential(d3.interpolateYlOrRd).domain([0, maxCount === 0 ? 1 : maxCount]);

    // --- Tooltip & Hover ---
    const tooltip = d3.select(".tooltip");
    let originalFill = null;
    const medalHoverColors = { 'Gold': '#ffd700', 'Silver': '#c0c0c0', 'Bronze': '#cd7f32' };

    const handleMouseOver = (event, d) => {
        tooltip.style("opacity", 0.9); // Always make tooltip visible on hover

        // --- Apply visual changes only if medal count > 0 ---
        if (d.Count > 0) {
            const element = d3.select(event.currentTarget);
            originalFill = element.attr("fill"); // Store original fill color
            const hoverColor = medalHoverColors[d.Medal];
            element
                .attr("fill", hoverColor) // Use medal-specific hover color
                .style("stroke", "#555")
                .style("stroke-width", 1.0);
        }
        // --- Cells with medal Count = 0 remain visually unchanged ---
    };

    const handleMouseMove = (event, d) => {
        let tooltipHtml = `<b>${d.Sport} (${d.Medal})</b>Year: ${d.Year}`;
        const stats = sportMedalStats.get(d.SportMedal);

        if (d.Count > 0) { // For cells containing data
            tooltipHtml += `<br>Medals: ${d3.format(",")(d.Count)}`;
            if (stats && stats.hasData) { // Add high/low only if stats are available
                if (d.Count === stats.max) tooltipHtml += `<br><b class="highlight-max">Highest for this category!</b>`;
                if (stats.min !== null && d.Count === stats.min && stats.min !== stats.max) tooltipHtml += `<br><b class="highlight-min">Lowest recorded for this category</b>`;
            }
        } else { // For empty cells (No data available)
            tooltipHtml += `<br>No data available`;
        }
        tooltip.html(tooltipHtml).style("left", (event.pageX + 15) + "px").style("top", (event.pageY - 30) + "px");
    };

    const handleMouseLeave = (event, d) => {
        tooltip.style("opacity", 0); // Always hide tooltip

        // --- Restore visual changes ONLY if count > 0 (and originalFill was stored) ---
        if (d.Count > 0 && originalFill) {
            d3.select(event.currentTarget)
                .attr("fill", originalFill) // Restore original fill color
                .style("stroke", "none"); // Remove stroke
        }
        originalFill = null; // Always clear stored color potentially stored from other cells
    };

    // Draw data (HeatMap)
    svg.selectAll("rect.heatmap-cell")
        .data(allCellsData) // Bind the comprehensive data
        .join("rect")
        .attr("class", "heatmap-cell")
        .attr("x", d => xScale(d.Year))
        .attr("y", d => yScale(d.SportMedal))
        .attr("width", xScale.bandwidth())
        .attr("height", yScale.bandwidth())
        .attr("fill", d => d.Count > 0 ? colorScale(d.Count) : "#f0f0f0") // Gray for count 0
        .style("stroke", "#none")
        .on("mouseover", handleMouseOver)
        .on("mousemove", handleMouseMove)
        .on("mouseleave", handleMouseLeave);

    // Draw peripherals (Axes based on full domains)
    // --- X Axis ---
    const xAxisGenerator = d3.axisBottom(xScale).tickValues(xScale.domain().filter((i, arr) => !(i % Math.max(1, Math.floor(arr.length / 15))))).tickSizeOuter(0).tickSizeInner(3).tickPadding(8);
    svg.append("g").attr("class", "x-axis").attr("transform", `translate(0, ${height})`).call(xAxisGenerator);
    svg.append("text").attr("class", "axis-label").attr("x", width / 2).attr("y", height + margin.bottom - 15).text("Year");
    // --- Y Axis (Medal Labels) ---
    const yAxisGenerator = d3.axisLeft(yScale).tickFormat(d => d.split('-')[1]).tickSize(0).tickPadding(5);
    svg.append("g").attr("class", "y-axis").call(yAxisGenerator);
    // --- Y Axis (Sport Group Labels) ---
    const sportsGroups = sportsDomain; // Use the derived sportsDomain
    svg.append("g").attr("class", "y-axis-sport-labels").attr("transform", `translate(${-margin.left + 10}, 0)`).selectAll("text").data(sportsGroups).join("text")
        .attr("x", 0).attr("y", sport => {
            // Calculate midpoint based on the full SportMedal domain for this sport
            const firstMedalKey = `${sport}-${medalTypes[0]}`;
            const lastMedalKey = `${sport}-${medalTypes[medalTypes.length - 1]}`;
            const y1 = yScale(firstMedalKey);
            const y2 = yScale(lastMedalKey);
            return (typeof y1 === 'number' && typeof y2 === 'number') ? y1 + (y2 - y1 + yScale.bandwidth()) / 2 : 0;
        }).attr("dy", "0.32em").style("text-anchor", "start").text(d => d);

    // Adding Horizontal lines to separate sport labels on Y-axiz
    const separatorLineGroup = svg.append("g")
        .attr("class", "sport-separator-lines")
        .attr("stroke", "#bbb") // Set common stroke color for lines
        .attr("stroke-width", 1);   // Set common stroke width

    // Get all sports except the last one to draw lines after
    const sportsToSeparate = sportsDomain.slice(0, -1);

    separatorLineGroup.selectAll("line")
        .data(sportsToSeparate)
        .join("line")
        .attr("class", "sport-separator")
        .attr("x1", -margin.left + 10) // Start near the Sport labels
        .attr("x2", -10)                // End just before the Y-axis (adjust as needed)
        .attr("y1", d => { // Y position calculation remains the same
            const bronzeKey = `${d}-Bronze`;
            const yPos = yScale(bronzeKey);
            if (typeof yPos === 'number') {
                return yPos + yScale.bandwidth() + (yScale.step() * yScale.paddingOuter() / 2);
            }
            return 0;
        })
        .attr("y2", d => { // Y2 is same as Y1
            const bronzeKey = `${d}-Bronze`;
            const yPos = yScale(bronzeKey);
            if (typeof yPos === 'number') {
                return yPos + yScale.bandwidth() + (yScale.step() * yScale.paddingOuter() / 2);
            }
            return 0;
        });

    // Draw Legend (Gradient Bar)
    const legendWidth = Math.min(width * 0.6, 400); const legendHeight = 10;
    const legendX = (width - legendWidth) / 2; const legendY = -margin.top / 2 - 15;
    const legend = svg.append("g").attr("class", "legend").attr("transform", `translate(${legendX}, ${legendY})`);
    const legendDefs = svg.append("defs"); const linearGradient = legendDefs.append("linearGradient").attr("id", "heatmap-gradient");
    const numStops = 10; linearGradient.selectAll("stop").data(d3.range(numStops + 1)).join("stop").attr("offset", d => `${(d / numStops) * 100}%`).attr("stop-color", d => colorScale((d / numStops) * maxCount));
    legend.append("rect").attr("x", 0).attr("y", 0).attr("width", legendWidth).attr("height", legendHeight).style("fill", "url(#heatmap-gradient)");
    const legendScale = d3.scaleLinear().domain(colorScale.domain()).range([0, legendWidth]);
    const legendAxis = d3.axisBottom(legendScale).ticks(5).tickSize(legendHeight + 4).tickFormat(d3.format(",.0f"));
    legend.append("g").attr("transform", `translate(0, 0)`).call(legendAxis).select(".domain").remove();
    legend.append("text").attr("class", "legend-title").attr("x", legendWidth / 2).attr("y", -10).text("Medal Count");

}   // End of HeatMap() function

createHeatmap(); // Function calling
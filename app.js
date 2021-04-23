const DURATION = 250;
const MARGIN = { left: 0, right: 6, top: 16, bottom: 6 };
const BAR_SIZE = 48
const N = 12;
const WIDTH = 695
const HEIGHT = MARGIN.top + BAR_SIZE * N + MARGIN.bottom;

const x = d3.scaleLinear([0, 1], [MARGIN.left, WIDTH - MARGIN.right])
const y = d3.scaleBand()
  .domain(d3.range(N + 1))
  .rangeRound([MARGIN.top, MARGIN.top + BAR_SIZE * (N + 1 + 0.1)])
  .padding(0.1)

query = '/data/v1/discussions?fields=DateCreated,Category&orderby=DateCreated ascending';
domo.get(query).then(data => {
  keyframes = computeKeyframes(data);
  nameframes = computeNameframes(keyframes);
  prev = computePrev(nameframes);
  next = computeNext(nameframes);
  renderChart(keyframes, nameframes, prev, next);
});

function computeKeyframes(data) {
  dataByDate = data.reduce(
    (acc, datum) => {
      const datePart = datum.DateCreated.split('T')[0];
      if (acc[datePart] !== undefined) {
        if (acc[datePart][datum.Category] !== undefined) {
          acc[datePart][datum.Category]++;
        } else {
          acc[datePart][datum.Category] = 1
        }
      } else {
        acc[datePart] = { [datum.Category]: 1 };
      }

      return acc;
    },
    {},
  );

  // sum totals over time via sliding window
  const dates = Object.keys(dataByDate);
  for (let i = 1; i < dates.length; i++) {
    const currentDate = dates[i];
    const previousDate = dates[i - 1];
    const previousDateData = dataByDate[previousDate];
    const currentDateData = dataByDate[currentDate];
    const categories = Object.keys(previousDateData);
    categories.forEach(category => {
      if (currentDateData[category] !== undefined) {
        dataByDate[currentDate][category] += previousDateData[category]
      } else {
        dataByDate[currentDate][category] = previousDateData[category]
      }
    })
  }

  // use arrays for d3
  const dataArr = dates.map(date => {
    const categories = Object.entries(dataByDate[date]);
    categories.sort((a, b) => b[1] - a[1])
    const rankedCategories = categories.map(([category, score], index) => ({
      name: category,
      value: score,
      rank: index,
    }));
    return [date, rankedCategories];
  })


  return dataArr;
}

function computeNameframes(keyframes) {
  return d3.groups(keyframes.flatMap(([, data]) => data), d => d.name);
}

function computePrev(nameframes) {
  return new Map(nameframes.flatMap(([, data]) => d3.pairs(data, (a, b) => [b, a])));
}

function computeNext(nameframes) {
  return new Map(nameframes.flatMap(([, data]) => d3.pairs(data)));
}


async function renderChart(keyframes, nameframes, prev, next) {
  const svg = d3.select('body').append('svg')
  // const svg = d3.create("svg")
    .attr("viewBox", [0, 0, WIDTH, HEIGHT]);
  
  const updateBars = bars(svg, prev, next);
  const updateAxis = axis(svg);
  const updateLabels = labels(svg, prev, next);
  const updateTicker = ticker(svg, keyframes);

  for (const keyframe of keyframes) {
    const transition = svg.transition()
        .duration(DURATION)
        .ease(d3.easeLinear);

    // Extract the top bar’s value.
    x.domain([0, keyframe[1][0].value]);

    updateAxis(keyframe, transition);
    updateBars(keyframe, transition);
    updateLabels(keyframe, transition);
    updateTicker(keyframe, transition);

    // invalidation.then(() => svg.interrupt());
    await transition.end();
  }
}

function bars(svg, prev, next) {
  let bar = svg.append("g")
      .attr("fill-opacity", 0.6)
    .selectAll("rect");

  return ([date, data], transition) => bar = bar
    .data(data.slice(0, N), d => d.name)
    .join(
      enter => enter.append("rect")
        .attr("fill", color)
        .attr("height", y.bandwidth())
        .attr("x", x(0))
        .attr("y", d => y((prev.get(d) || d).rank))
        .attr("width", d => x((prev.get(d) || d).value) - x(0)),
      update => update,
      exit => exit.transition(transition).remove()
        .attr("y", d => y((next.get(d) || d).rank))
        .attr("width", d => x((next.get(d) || d).value) - x(0))
    )
    .call(bar => bar.transition(transition)
      .attr("y", d => y(d.rank))
      .attr("width", d => x(d.value) - x(0)));
}

function axis(svg) {
  const g = svg.append("g")
      .attr("transform", `translate(0,${MARGIN.top})`);

  const axis = d3.axisTop(x)
      .ticks(WIDTH / 160)
      .tickSizeOuter(0)
      .tickSizeInner(-BAR_SIZE * (N + y.padding()));

  return (_, transition) => {
    g.transition(transition).call(axis);
    g.select(".tick:first-of-type text").remove();
    g.selectAll(".tick:not(:first-of-type) line").attr("stroke", "white");
    g.select(".domain").remove();
  };
}

function labels(svg, prev, next) {
  let label = svg.append("g")
      .style("font", "bold 12px var(--sans-serif)")
      .style("font-variant-numeric", "tabular-nums")
      .attr("text-anchor", "end")
    .selectAll("text");

  return ([date, data], transition) => label = label
    .data(data.slice(0, N), d => d.name)
    .join(
      enter => enter.append("text")
        .attr("transform", d => `translate(${x((prev.get(d) || d).value)},${y((prev.get(d) || d).rank)})`)
        .attr("y", y.bandwidth() / 2)
        .attr("x", -6)
        .attr("dy", "-0.25em")
        .text(d => d.name)
        .call(text => text.append("tspan")
          .attr("fill-opacity", 0.7)
          .attr("font-weight", "normal")
          .attr("x", -6)
          .attr("dy", "1.15em")),
      update => update,
      exit => exit.transition(transition).remove()
        .attr("transform", d => `translate(${x((next.get(d) || d).value)},${y((next.get(d) || d).rank)})`)
        .call(g => g.select("tspan").tween("text", d => textTween(d.value, (next.get(d) || d).value)))
    )
    .call(bar => bar.transition(transition)
      .attr("transform", d => `translate(${x(d.value)},${y(d.rank)})`)
      .call(g => g.select("tspan").tween("text", d => textTween((prev.get(d) || d).value, d.value))))
}

function ticker(svg, keyframes) {
  const now = svg.append("text")
      .style("font", `bold ${BAR_SIZE}px var(--sans-serif)`)
      .style("font-variant-numeric", "tabular-nums")
      .attr("text-anchor", "end")
      .attr("x", WIDTH - 6)
      .attr("y", MARGIN.top + BAR_SIZE * (N - 0.45))
      .attr("dy", "0.32em")
      .text(formatDate(keyframes[0][0]));

  return ([date], transition) => {
    transition.end().then(() => now.text(formatDate(date)));
  };
}

const formatNumber = d3.format(",d");
function formatDate(date) {
  return date;
  // return date.split('-')[0];
}

function textTween(a, b) {
  const i = d3.interpolateNumber(a, b);
  return function(t) {
    this.textContent = formatNumber(i(t));
  };
}

function color(d) {
  return stringToColour(d.name)
}

var stringToColour = function(str) {
  var hash = 0;
  for (var i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  var colour = '#';
  for (var i = 0; i < 3; i++) {
    var value = (hash >> (i * 8)) & 0xFF;
    colour += ('00' + value.toString(16)).substr(-2);
  }
  return colour;
}

(function(){
	var stationList = [104, 109, 24, 121, 50, 107, 44, 117, 122, 108, 111, 116, 106, 60, 43, 115];
	
	var view = function(){
		var w = window, d = document.documentElement, b = document.getElementsByTagName("body")[0];
		var x = w.innerWidth || d.clientWidth || b,clientWidth;
		var y = w.innerHeight || d.clientHeight || b.clientHeight;
		return {width: x, height: y};
	}()

	var margin = {top:50, left:50, right:50, bottom:50}, 
		height =view.height-margin.top -margin.bottom,
		width = view.width-margin.left-margin.right;

	var svg = d3.select("#map")
				.append("svg")
				.attr("id", "map-svg")
				.attr("height", height+margin.top+margin.bottom)
				.attr("width", width+margin.left+margin.right)
				.append("g")
				.attr("transform", "translate("+margin.left+","+margin.top+")");

    var field = d3.select("#map")
	            .append("canvas")
				.attr("id", "field-canvas")
				.attr("height", height+margin.top+margin.bottom)
				.attr("width", width+margin.left+margin.right)
				.append("g")
				.attr("transform", "translate("+margin.left+","+margin.top+")");

    var overlay = d3.select("#map")
	                .append("canvas")
					.attr("id", "overlay-canvas")
					.attr("height", height+margin.top+margin.bottom)
					.attr("width", width+margin.left+margin.right)
					.append("g")
					.attr("transform", "translate("+margin.left+","+margin.top+")");

	function request4wind(sNum){
		return new Promise(function(resolve, reject){
			var xhr = new XMLHttpRequest();
			xhr.open('POST', 'https://www.weather.gov.sg/wp-content/themes/wiptheme/page-functions/functions-ajax-wind-chart.php', true);
			xhr.setRequestHeader('Content-type', 'application/x-www-form-urlencoded');
			xhr.onload=function(){
				if (xhr.status == 200){
					var innerData =JSON.parse(xhr.responseText)
					for (i = 0, len = innerData.length; i < len; i++ ){
					 	if ("windSpeedKpr" in innerData[len-i-1]){
							resolve([sNum, innerData[len-i-1].windSpeedKpr, innerData[len-i-1].windDirection]);
			            }
			        }
					resolve(null);
				} else {
					reject(Error(xhr.statusText));
				}

				xhr.onerror=function(){
					reject(Error("Network Error"))
				}
			};
			xhr.send('stationCode=S'+sNum +"&hrType="+ 12);
		});
	}

	function getWindData(callback){
		var requests = stationList.map(function(sNum){return request4wind(sNum);});
		Promise.all(requests).then(function(results){
			var filtered = results.filter(function (el){
				return el!=null;
			});
			callback(null, filtered)
		})
	}

	d3.queue()
	  .defer(d3.json, "sgtopo.json")
	  .defer(d3.json, "station-data.json")
	  .defer(getWindData)
	  .await(ready)
	
	var projection = d3.geoMercator()
					   .center([103.8470919, 1.314736766])
					   .translate([width/2, height/2])
					   .scale(120000*view.width/2000)
	
	var path = d3.geoPath()
				 .projection(projection) 

	function asColorStyle(r, g, b, a){
		return "rgba("+ r +", "+ g +", "+ b +", "+ a +")";
	}

	function createDisplayBounds(data){
		var upperLeft = projection([data.bbox[0], data.bbox[3]]).map(Math.floor);
		var lowerRight = projection([data.bbox[2], data.bbox[1]]).map(Math.ceil);
		return {
			x: upperLeft[0]+margin.left,
			y: upperLeft[1]+margin.top,
			width: lowerRight[0]-upperLeft[0]+1,
			height: lowerRight[1]-upperLeft[1]+1
		}
	}

	function buildPointsFromSamples(stations, samples, transform){
		return new Promise((resolve, reject) => {
			var points = [];
			samples.forEach(function(sample){
				for (var i = 0; i < 16; i++){
					if (stations[i][0] == sample[0]){
						var coordinates = [stations[i][3], stations[i][2]];
					}
				}
				var point = projection(coordinates);
				var value = transform(sample);
				if (value !== null) {
					points.push([point[0], point[1], value]);
				}
			});
			resolve(points);
		});
	}

	function buildMeshes(topo){
		var path = d3.geoPath().projection(projection);
		var outerBoundary = topojson.mesh(topo, topo.objects["sg-"], function(a, b){return a === b;});
		var divisionBoundary = topojson.mesh(topo, topo.objects["sg-"], function(a, b){return a !== b;});

		return {
			path: path, 
			outerBoundary: outerBoundary,
			divisionBoundary: divisionBoundary
		};
	}

	function renderMasks(mesh){
		var canvas = document.createElement("canvas");
		d3.select(canvas).attr("width", view.width).attr("height", view.height);
		var g = canvas.getContext("2d");
		var path = d3.geoPath().projection(projection).context(g);

		path(mesh.outerBoundary);
	
		g.strokeStyle = asColorStyle(255, 0, 0, 1);
		g.lineWidth = 2;
		g.stroke();

		g.fillStyle = asColorStyle(255, 255, 0, 1);
		g.fill();

		g.strokeStyle = asColorStyle(255, 0, 0, 1);
		g.lineWidth = 2;
		g.stroke();

		var width = canvas.width;
		var data = g.getImageData(0, 0, canvas.width, canvas.height).data;

		return{
			fieldMask: function(x, y){
				var i = (y * width + x) * 4;
				return data[i] > 0;
			},
			displayMask: function(x, y){
				var i = (y * width + x) * 4 + 1; 
				return data[i] > 0;
			}
		}
	}

    function binarySearch(a, v) {
		var low = 0, high = a.length - 1;
		while (low <= high) {
			var mid = low + ((high - low) >> 1), p = a[mid];
			if (p < v) {
				low = mid + 1;
			} else if (p === v) {
				return mid;
			} else {
			    high = mid - 1;
			}
		}
		return -(low + 1);
	}


	function createField(columns) {
		var nilVector = [NaN, NaN, -2];
		var field = function(x, y){
			var column = columns[Math.round(x)];
			if (column) {
				var v = column[Math.round(y)-column[0]];
				if (v){
					return v;
				}
			}
			return nilVector;
		}

		field.randomize = function(){
			var w = [0];
			for (var i = 1; i <= columns.length; i++){
				var column = columns[i-1];
				w[i] = w[i-1] + (column ? column.length - 1 : 0);
			}
			var pointCount = w[w.length -1];

			return function(o){
				var p = Math.floor(Math.random()*pointCount);
				var x = binarySearch(w, p);
				x = x < 0 ? -x - 2 : x;
				while (!columns[o.x = x]){
					x++;
				}
				o.y = p - w[x] + 1 + columns[x][0];
				return o;
			}
		}();
		return field;
	}

	function interpolateField(stations, samples, bounds, masks){
		return new Promise(function(resolve, reject){	
			buildPointsFromSamples(stations, samples, function(sample){
				var theta = sample[2]/180*3.1415926;
				var m = sample[1];
				var u = -m*Math.sin(theta);
				var v = -m*Math.cos(theta);
				return [u, -v];
			}).then(function(points){
				var interpolate = mvi.inverseDistanceWeighting(points, 5);
				var columns = [];
				var displayMask = masks.displayMask;
				var fieldMask = masks.fieldMask;
				var xBound = bounds.x + bounds.width;
				var yBound = bounds.y + bounds.height;
				var x = bounds.x;	

				function interpolateColumn(x){
					var yMin, yMax;
					for (yMin = 0; yMin < yBound && !fieldMask(x, yMin); yMin++){
					}
					for (yMax = yBound-1; yMax > yMin && !fieldMask(x, yMax); yMax--){
					}
			
					if (yMin <= yMax){
						var column = [];
						var offset = column[0] = yMin - 1;
						for (var y = yMin; y <= yMax; y++) {
							var v = null;
							if (fieldMask(x, y)) {
								v = [0, 0, 0];
								v = interpolate(x, y, v);
								v[2] = displayMask(x, y) ? Math.sqrt(v[0] * v[0] + v[1] * v[1]) : -1;
								v = mvi.scaleVector(v, +(bounds.height / 700).toFixed(3));
							}
							column[y - offset] = v;
						}
						return column;
					} else {
						return null;
					}
				}
		
				(function batchInterpolate(){
					try {
						var start = +new Date;
						while (x < xBound){
							columns[x] = interpolateColumn(x);
							x += 1;
							if ((+new Date - start) > 100){
								setTimeout(batchInterpolate, 25);
								return;
							}
						}
						resolve(createField(columns));
					}
					catch (e) {
						reject(e);
					}
				})();
			});
		});
	}


    function animate(bound, field){
			var styles = [];
			for (var j = 85; j <= 255; j+=5){
				styles.push(asColorStyle(j, j, j, 1));
			}
			var buckets = styles.map(function(){return [];});

			function styleIndex(m){
				return Math.floor(Math.min(m, 10)/10*(styles.length-1));
			}

	        var particles = [];
			for (var i = 0; i < 500; ++i){
				var temp = {age: Math.random()*40};
				console.log(temp);
				particles.push(field.randomize(temp));
			}
		    console.log(particles);	

			function evolve(){
				buckets.forEach(function(bucket){
					bucket.length = 0;
				});
				particles.forEach(function(particle){
					if (particle.age > 40){
						field.randomize(particle).age = 0;
					}
					var x = particle.x;
					var y = particle.y;
					var v = field(x, y);
					var m = v[2];
					if (m == -2){
						particle.age = 40;
					} else {
						var xt = x + v[0];
						var yt = y + v[1];
					
						if (m > -1 && field(xt, yt)[2] > -1){
							particle.xt = xt;
							particle.yt = yt;
							buckets[styleIndex(m)].push(particle)
						} else {
							particle.x = xt;
							particle.y = yt;
						}
					}
					particle.age += 1;
				})
			}

			var g = d3.select("#field-canvas").node().getContext("2d");
			g.lineWidth = 1.0;
			g.fillStyle = "rgba(0, 0, 0, 0.95)";
			function draw(){
			//Fade existing particle trails
				var prev = g.globalCompositeOperation;
				g.globalCompositeOperation = "destination-in";
				g.fillRect(bound.x, bound.y, bound.width, bound.height);
				g.globalCompositeOperation = prev;
			
				buckets.forEach(function(bucket, i){
					if (bucket.length > 0){
						g.beginPath();
						g.strokeStyle = styles[i];
						bucket.forEach(function(particle){
							g.moveTo(particle.x+margin.left, particle.y+margin.top);
							g.lineTo(particle.xt+margin.left, particle.yt+margin.top);
							particle.x = particle.xt;
							particle.y = particle.yt;
						});
						g.stroke();
					}
				});
			}
			
			(function frame(){
				evolve();
				draw();
				setTimeout(frame, 100);
			})();
	}
//	
//	function drawOverlay(){
//		var g = d3.select("#overlay-canvas").node().getContext("2d");
//		
//	}

	

	function ready(error, data, station, wind){
		console.log(station)
		
		var geometries = topojson.feature(data, data.objects["sg-"]).features
		svg.selectAll(".tokyo")
		   .data(geometries)
		   .enter().append("path")
		   .attr("class", "tokyo")
		   .attr("d", path)
		   .on("mouseover", function(d){
				d3.select(this).classed("selected", true)
		   })
		   .on("mouseout", function(d){
				d3.select(this).classed("selected", false)	
		   })

		
		svg.selectAll(".station")
		   .data(station)
		   .enter().append("circle")
		   .attr("class", "station")
		   .attr("r", 2)
		   .attr("cx", function(d){
				var coords = projection([d[3], d[2]])
				return coords[0];
		   })
		   .attr("cy", function(d){
				var coords = projection([d[3], d[2]])
				return coords[1];
		   })

		console.log(wind)

		bound = createDisplayBounds(data);
	
		var mesh = buildMeshes(data);
		var masks = renderMasks(mesh);

		console.log("mesh",  mesh)
		console.log("mask", masks)
		
		interpolateField(station, wind, bound, masks).then(function(field){
			animate(bound, field)
			return;
		});
	}

})();

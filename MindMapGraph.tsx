
import React, { useEffect, useRef } from 'react';
import * as d3 from 'd3';
import { MindMapNode } from '../types';

interface MindMapGraphProps {
  data: MindMapNode;
}

// Color scale for different depth levels to make it visually appealing
// Level 0 (Root): Dark Blue
// Level 1: Blue
// Level 2: Light Blue
// Level 3: Sky Blue
// Level 4: Pale Blue
const colorScale = d3.scaleOrdinal<string>()
  .domain(["0", "1", "2", "3", "4"])
  .range(["#1e3a8a", "#2563eb", "#3b82f6", "#60a5fa", "#93c5fd"]);

const MindMapGraph: React.FC<MindMapGraphProps> = ({ data }) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!data || !svgRef.current || !containerRef.current) return;

    const container = containerRef.current;
    const width = container.clientWidth || 900;
    const height = 600;
    
    // 1. Cleanup
    d3.select(svgRef.current).selectAll("*").remove();

    // 2. Setup SVG & Zoom
    const svg = d3.select(svgRef.current)
      .attr("width", width)
      .attr("height", height)
      .style("background-color", "#f8fafc") // Very light gray background
      .call(d3.zoom<SVGSVGElement, unknown>()
        .scaleExtent([0.1, 3])
        .on("zoom", (event) => {
           g.attr("transform", event.transform);
        }) as any
      );

    // 3. Container Group
    const g = svg.append("g")
      .attr("transform", "translate(100,300)"); // Initial centering

    let i = 0;
    const duration = 500;
    
    // 4. Hierarchy setup
    const root = d3.hierarchy(data) as any;
    root.x0 = height / 2;
    root.y0 = 0;

    // Tree Layout: nodeSize([height, width]) -> determines spacing
    // Increased spacing to fit the pills
    const tree = d3.tree().nodeSize([50, 200]); 

    update(root);

    function update(source: any) {
      const treeData = tree(root);
      const nodes = treeData.descendants();
      const links = treeData.links();

      // Normalize depth for fixed horizontal spacing
      nodes.forEach((d: any) => { d.y = d.depth * 220; });

      // ****************** Nodes section ***************************

      // Update the nodes...
      const node = g.selectAll<SVGGElement, any>('g.node')
        .data(nodes, (d: any) => d.id || (d.id = ++i));

      // Enter any new nodes at the parent's previous position.
      const nodeEnter = node.enter().append('g')
        .attr('class', 'node')
        .attr("transform", (d: any) => `translate(${source.y0},${source.x0})`)
        .on('click', click)
        .style("cursor", "pointer");

      // 1. Add Rect (Background)
      // Distinct colorful pills
      nodeEnter.append('rect')
        .attr('rx', 15) // Round corners
        .attr('ry', 15)
        .attr('height', 34) // Fixed height
        .attr('y', -17)     // Centered vertically
        .style("fill", (d: any) => {
           // If children are collapsed, use a distinct color or opacity
           return d._children ? "#fef3c7" : "#ffffff"; // Yellow-ish if collapsed, White if expanded/leaf
        })
        .style("stroke", (d: any) => colorScale(d.depth.toString()))
        .style("stroke-width", 2.5)
        .style("filter", "drop-shadow(1px 1px 2px rgba(0,0,0,0.15))"); // Shadow

      // 2. Add Text
      nodeEnter.append('text')
        .attr("dy", ".35em")
        .attr("text-anchor", "middle")
        .text((d: any) => d.data.name)
        .style("font-size", "14px")
        .style("font-weight", "600")
        .style("fill", "#1e293b") // Dark Slate (Readable)
        .style("font-family", "'Noto Sans TC', sans-serif")
        .style("pointer-events", "none") // Click goes to rect
        .style("fill-opacity", 1e-6);

      // UPDATE
      const nodeUpdate = node.merge(nodeEnter);

      // Transition to the proper position for the node
      nodeUpdate.transition()
        .duration(duration)
        .attr("transform", (d: any) => `translate(${d.y},${d.x})`);

      // Update Text Opacity
      nodeUpdate.select('text')
        .style("fill-opacity", 1);

      // Dynamic Rect Sizing based on text width
      nodeUpdate.each(function(d: any) {
        const gNode = d3.select(this);
        const textNode = gNode.select('text').node() as SVGTextElement;
        if (textNode) {
          const bbox = textNode.getBBox();
          const padding = 30; 
          const rectWidth = Math.max(80, bbox.width + padding);
          
          // Update rect styling based on state
          gNode.select('rect')
            .transition().duration(duration)
            .attr('width', rectWidth)
            .attr('x', -rectWidth / 2) // Center horizontally
            .style("fill", d._children ? "#fef3c7" : "#e0f2fe") // Change color if collapsed
            .style("stroke", colorScale(d.depth.toString()));
        }
      });

      // Remove exiting nodes
      const nodeExit = node.exit().transition()
        .duration(duration)
        .attr("transform", (d: any) => `translate(${source.y},${source.x})`)
        .remove();

      nodeExit.select('rect').attr('width', 1e-6).attr('height', 1e-6);
      nodeExit.select('text').style('fill-opacity', 1e-6);

      // ****************** Links section ***************************

      const link = g.selectAll<SVGPathElement, any>('path.link')
        .data(links, (d: any) => d.target.id);

      // Enter any new links at the parent's previous position.
      const linkEnter = link.enter().insert('path', "g")
        .attr("class", "link")
        .attr("fill", "none")
        .attr("stroke", (d: any) => colorScale(d.target.depth.toString()) as string) // Link color matches target node level
        .attr("stroke-width", 2)
        .attr("stroke-opacity", 0.4)
        .attr('d', (d: any) => {
          const o = { x: source.x0, y: source.y0 };
          return diagonal(o, o);
        });

      // UPDATE
      const linkUpdate = link.merge(linkEnter);

      // Transition back to the parent element position
      linkUpdate.transition()
        .duration(duration)
        .attr('d', (d: any) => diagonal(d.source, d.target));

      // Remove any exiting links
      link.exit().transition()
        .duration(duration)
        .attr('d', (d: any) => {
          const o = { x: source.x, y: source.y };
          return diagonal(o, o);
        })
        .remove();

      nodes.forEach((d: any) => {
        d.x0 = d.x;
        d.y0 = d.y;
      });

      // Creates a curved (diagonal) path from parent to the child nodes
      function diagonal(s: any, d: any) {
        return `M ${s.y} ${s.x}
                C ${(s.y + d.y) / 2} ${s.x},
                  ${(s.y + d.y) / 2} ${d.x},
                  ${d.y} ${d.x}`;
      }

      // Toggle children on click.
      function click(event: any, d: any) {
        if (d.children) {
          d._children = d.children;
          d.children = null;
        } else {
          d.children = d._children;
          d._children = null;
        }
        update(d);
      }
    }

    // Initial Center Zoom
    const initialTransform = d3.zoomIdentity.translate(100, height/2).scale(0.9);
    svg.call(d3.zoom<SVGSVGElement, unknown>().transform as any, initialTransform);

  }, [data]);

  return (
    <div ref={containerRef} className="w-full h-[650px] overflow-hidden border border-gray-200 rounded-3xl bg-slate-50 shadow-lg relative">
      <svg ref={svgRef} className="w-full h-full cursor-move"></svg>
      <div className="absolute bottom-4 right-4 text-xs font-medium text-slate-500 pointer-events-none bg-white/80 px-3 py-2 rounded-lg backdrop-blur-sm border border-gray-200">
        🖱️ 點擊節點展開/收合 • 滾輪縮放 • 拖曳移動
      </div>
    </div>
  );
};

export default MindMapGraph;

import React, { useEffect, useRef } from 'react';
import * as d3 from 'd3';
import { MindMapNode } from './types';

interface MindMapGraphProps {
  data: MindMapNode;
}

// 顏色設定
const colorScale = d3.scaleOrdinal<string>()
  .domain(["0", "1", "2", "3", "4"])
  .range(["#1e3a8a", "#2563eb", "#3b82f6", "#60a5fa", "#93c5fd"]);

// 🛠️ 修改 1: 新增切字串函式 (每10個字一行)
const splitString = (str: string, limit: number) => {
  const result = [];
  for (let i = 0; i < str.length; i += limit) {
    result.push(str.substring(i, i + limit));
  }
  return result;
};

const MindMapGraph: React.FC<MindMapGraphProps> = ({ data }) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!data || !svgRef.current || !containerRef.current) return;

    const container = containerRef.current;
    const width = container.clientWidth || 900;
    const height = 600;
    
    // 1. 清理舊圖
    d3.select(svgRef.current).selectAll("*").remove();

    // 2. 設定 SVG 與 Zoom
    const svg = d3.select(svgRef.current)
      .attr("width", width)
      .attr("height", height)
      .style("background-color", "#f8fafc")
      .call(d3.zoom<SVGSVGElement, unknown>()
        .scaleExtent([0.1, 3])
        .on("zoom", (event) => {
           g.attr("transform", event.transform);
        }) as any
      );

    // 3. 容器群組
    const g = svg.append("g")
      .attr("transform", "translate(100,300)");

    let i = 0;
    const duration = 500;
    
    // 4. 設定層級資料
    const root = d3.hierarchy(data) as any;
    root.x0 = height / 2;
    root.y0 = 0;

    // 🛠️ 修改 2: 調整節點間距
    // 第一個數字是「垂直間距」，改大 (50 -> 90) 以避免換行後上下重疊
    // 第二個數字是「水平間距」
    const tree = d3.tree().nodeSize([90, 220]); 

    update(root);

    function update(source: any) {
      const treeData = tree(root);
      const nodes = treeData.descendants();
      const links = treeData.links();

      // 固定水平間距
      nodes.forEach((d: any) => { d.y = d.depth * 240; });

      // ****************** Nodes section ***************************

      const node = g.selectAll<SVGGElement, any>('g.node')
        .data(nodes, (d: any) => d.id || (d.id = ++i));

      // 新增節點
      const nodeEnter = node.enter().append('g')
        .attr('class', 'node')
        .attr("transform", (d: any) => `translate(${source.y0},${source.x0})`)
        .on('click', click)
        .style("cursor", "pointer");

      // 1. 加入背景框 (先給預設值，後面會依照文字大小動態調整)
      nodeEnter.append('rect')
        .attr('rx', 12)
        .attr('ry', 12)
        .attr('height', 40) // 預設高度
        .style("fill", (d: any) => d._children ? "#fef3c7" : "#ffffff")
        .style("stroke", (d: any) => colorScale(d.depth.toString()))
        .style("stroke-width", 2.5)
        .style("filter", "drop-shadow(1px 1px 2px rgba(0,0,0,0.15))");

      // 2. 🛠️ 修改 3: 使用 tspan 實作換行
      const text = nodeEnter.append('text')
        .attr("text-anchor", "middle")
        .style("font-size", "14px")
        .style("font-weight", "600")
        .style("fill", "#1e293b")
        .style("font-family", "'Noto Sans TC', sans-serif")
        .style("pointer-events", "none")
        .style("fill-opacity", 1e-6);

      // 對每個節點的文字進行切分並加入 tspan
      text.each(function(d: any) {
        const lines = splitString(d.data.name, 20); // 這裡設定 10 個字換行
        const el = d3.select(this);
        
        // 為了讓多行文字垂直置中，我們需要計算起始的 y 偏移
        // 一行字大約高 1.2em (約 16-18px)
        // 如果有 2 行，總高 2.4em，起始點要往上提 0.6em 左右
        const lineHeight = 1.2; // em
        const startDy = -(lines.length - 1) * (lineHeight / 2); 

        lines.forEach((line, index) => {
           el.append('tspan')
             .attr('x', 0)
             .attr('dy', index === 0 ? `${startDy + 0.35}em` : `${lineHeight}em`) // 第一行定位，之後相對定位
             .text(line);
        });
      });

      // UPDATE
      const nodeUpdate = node.merge(nodeEnter);

      // 移動到正確位置
      nodeUpdate.transition()
        .duration(duration)
        .attr("transform", (d: any) => `translate(${d.y},${d.x})`);

      nodeUpdate.select('text')
        .style("fill-opacity", 1);

      // 3. 🛠️ 修改 4: 動態計算框框大小 (寬度 + 高度)
      nodeUpdate.each(function(d: any) {
        const gNode = d3.select(this);
        const textNode = gNode.select('text').node() as SVGTextElement;
        
        if (textNode) {
          const bbox = textNode.getBBox();
          const paddingX = 30; // 左右留白
          const paddingY = 20; // 上下留白
          
          const rectWidth = Math.max(80, bbox.width + paddingX);
          const rectHeight = Math.max(40, bbox.height + paddingY); // 確保高度隨文字長高
          
          gNode.select('rect')
            .transition().duration(duration)
            .attr('width', rectWidth)
            .attr('height', rectHeight)
            .attr('x', -rectWidth / 2) // 水平置中
            .attr('y', -rectHeight / 2) // 垂直置中 (因為文字中心是 0,0)
            .style("fill", d._children ? "#fef3c7" : "#e0f2fe")
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

      const linkEnter = link.enter().insert('path', "g")
        .attr("class", "link")
        .attr("fill", "none")
        .attr("stroke", (d: any) => colorScale(d.target.depth.toString()) as string)
        .attr("stroke-width", 2)
        .attr("stroke-opacity", 0.4)
        .attr('d', (d: any) => {
          const o = { x: source.x0, y: source.y0 };
          return diagonal(o, o);
        });

      const linkUpdate = link.merge(linkEnter);

      linkUpdate.transition()
        .duration(duration)
        .attr('d', (d: any) => diagonal(d.source, d.target));

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

      function diagonal(s: any, d: any) {
        return `M ${s.y} ${s.x}
                C ${(s.y + d.y) / 2} ${s.x},
                  ${(s.y + d.y) / 2} ${d.x},
                  ${d.y} ${d.x}`;
      }

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

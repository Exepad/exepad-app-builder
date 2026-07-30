# Test Prompts: Custom Code-Heavy Components

Natural user prompts that should push the planner toward highly custom, code-heavy `CodeComponentProps` implementations inside the current TSX pipeline. Organized by the capability gap that makes a plain content/layout component insufficient.

The agent should recognize these as requiring bespoke TSX behavior without the user ever mentioning implementation details. There is no separate legacy JSON component mode in the current pipeline.

---

## Custom Data Visualization (D3, custom SVG, canvas)

1. "Create a dashboard with a force-directed network graph showing relationships between entities."
2. "Build an analytics page with a treemap visualization of budget allocation by department"
3. "Make a dashboard with a Sankey diagram showing user flow through our conversion funnel"
4. "Create a page with a zoomable world map showing customer distribution — I want to click on countries to drill down"
5. "Build a dashboard with a real-time animated bubble chart where bubble size represents deal value"
6. "Make a visualization page with a chord diagram showing inter-department communication patterns"
7. "Create a radial/sunburst chart showing our product category hierarchy with click-to-zoom"
8. "Build a page with a heatmap calendar — like GitHub's contribution graph — showing daily activity"
9. "Make a dashboard with a Gantt chart for project timeline visualization with draggable task bars"
10. "Create a page with an animated globe showing real-time server locations and traffic flow between them"

## Rich Text / Code Editors

11. "Create a CMS with a rich text editor — bold, italic, headings, images, embeds, the whole thing"
12. "Build a documentation app with a markdown editor and live preview side by side"
13. "Make a code playground page with a code editor that has syntax highlighting and a run button"
14. "Create a wiki app where users can edit pages with a WYSIWYG editor"
15. "Build a note-taking app with a Notion-style block editor — drag blocks, slash commands, markdown shortcuts. Use custom app type"
16. "Make an email template builder with a rich text editor and variable insertion"

## Drawing / Canvas / Whiteboard

17. "Create a collaborative whiteboard app where users can draw, add sticky notes, and connect shapes"
18. "Build a simple drawing tool — brush, eraser, color picker, undo/redo, and save as image"
19. "Make a floor plan editor where you can drag and drop furniture pieces onto a room layout"
20. "Create a diagram builder — drag shapes onto a canvas, connect them with arrows, label the connections"
21. "Build a signature pad page where users can sign with their finger or mouse and submit"
22. "Make a photo annotation tool — upload an image, draw circles and arrows on it, add text labels"

## Advanced Drag-and-Drop / Sortable

23. "Create a priority board where you can drag and reorder items across multiple columns — like Trello but with custom card layouts"
24. "Build a curriculum builder where you can drag lessons into a course sequence and reorder them"
25. "Make a page builder interface where you can drag content blocks and rearrange the layout"
26. "Create a playlist editor where you can drag songs to reorder them and drag between playlists"
27. "Build a menu editor for a restaurant — drag dishes between categories, reorder within a category"

## 3D / WebGL / Three.js

28. "Create a product page with a 3D model viewer — rotate, zoom, and switch colors on a shoe model"
29. "Build a data center visualization page with a 3D rack layout showing server status"
30. "Make a real estate listing page with a 3D walkthrough of the property"
31. "Create an architecture portfolio page where project models can be viewed in 3D with orbit controls"
32. "Build an interactive periodic table where clicking an element shows a 3D model of its atomic structure"

## Maps / Geospatial

33. "Create a delivery tracking page with a live map showing driver locations and route paths"
34. "Build a store locator with a map that clusters nearby stores and draws drive-time radius circles"
35. "Make a real estate app with a map where you can draw a boundary to search for properties in that area"
36. "Create a logistics dashboard with a map showing shipment routes as animated lines between warehouses"
37. "Build a field service app with a map showing technician locations, job pins, and optimized route suggestions"

## Real-Time / Streaming / Live Updates

38. "Create a stock ticker page with a real-time candlestick chart that updates every second"
39. "Build a social media monitoring dashboard with a live-updating word cloud from trending topics"
40. "Make a live auction page — bidding updates in real time, countdown timer, and a bid history feed"
41. "Create a monitoring dashboard with real-time server metrics — CPU, memory, network as live line graphs"
42. "Build a collaborative document where multiple users see each other's cursors and edits in real time"

## Advanced Tables / Grids

43. "Create a spreadsheet-like data editor with inline cell editing, formulas, column resizing, and frozen rows"
44. "Build a pivot table page where users can drag fields into rows, columns, and values to slice data dynamically"
45. "Make a data grid with Excel-style multi-cell selection, copy-paste, and bulk editing"
46. "Create a comparison table where users can drag columns to reorder them and pin columns while scrolling"

## Custom Animations / Motion Beyond Presets

47. "Create a landing page with a hero animation where particles form our logo and then scatter on scroll"
48. "Build an interactive infographic where elements animate and rearrange as you scroll through the story"
49. "Make a page with a morphing shape animation — smooth transitions between different SVG shapes on scroll"
50. "Create a stats page where the numbers do a slot-machine-style spin before revealing the final value"

## Audio / Video / Media

51. "Create a podcast app with a custom audio player — waveform visualization, playback speed, chapter markers"
52. "Build a video annotation tool — play a video, mark timestamps, add notes at specific moments"
53. "Make a music production page with a multi-track timeline where you can arrange and trim audio clips"
54. "Create a language learning app with a pronunciation tool — record, play back, and see a waveform comparison"

## Complex Form Interactions

55. "Create a form with an address autocomplete field that suggests addresses as you type and fills in city/state/zip"
56. "Build a color picker form field — not a text input, an actual visual color wheel with opacity slider"
57. "Make a form with a tag input field where you can type, autocomplete, and click to add/remove tags as chips"
58. "Create a scheduling form with a visual time range picker — drag to select blocks of time on a week grid"
59. "Build a form with an image cropper — upload a photo, drag to crop area, preview the result"

## Math / Scientific / Specialized Rendering

60. "Create a math homework app that renders LaTeX equations and has an equation editor input"
61. "Build a chemistry tool that renders molecular structures from SMILES notation"
62. "Make a music theory app that renders sheet music notation and plays it back"
63. "Create a circuit diagram tool where you can drop components and wire them together"

## File / Document Processing (Client-Side)

64. "Create a CSV import tool that previews the data in a table, lets you map columns, and handles duplicates"
65. "Build a PDF viewer page with annotation tools — highlight, comment, and bookmark"
66. "Make an image gallery with client-side filters — brightness, contrast, saturation sliders with live preview"
67. "Create a file diff viewer that shows side-by-side comparison of two uploaded text files with highlighted changes"

## Hybrid: Mostly JSON App With One Code Section

68. "Build a CRM but add a network graph on the contact detail page showing their connections to other contacts"
69. "Create a project management app, but the timeline page should be a Gantt chart with draggable bars"
70. "Make a standard e-commerce admin, but add a product image editor page with crop and resize tools"
71. "Build an HR app with a regular employee list, but add an org chart page that renders as an interactive tree"
72. "Create a real estate listing site, but each property page should have a 3D model viewer for the floor plan"
73. "Build a standard analytics dashboard, but one section should be a geographic heatmap with zoom and pan"
74. "Make a restaurant management app, but the floor plan page should let you drag tables to rearrange seating"
75. "Create a learning platform with regular course pages, but the code exercises page needs a live code editor with syntax highlighting"

## Stress Tests / Boundary Cases

76. "Create a simple bar chart showing monthly revenue" — *should stay a standard chart-oriented component, not trigger an unusually custom build path*
77. "Build a kanban board with three columns" — *should stay a standard dashboard/task-management component unless the prompt asks for bespoke interactions*
78. "Make a sortable data table with filters" — *should stay a standard data-app component unless the prompt asks for spreadsheet-like behavior*
79. "Create a page with a force-directed graph AND a regular data table below it" — *hybrid in complexity: custom code for the graph, simpler component patterns for the table section*
80. "Build a dashboard where one widget is a standard pie chart and another is a custom animated radial gauge with needle" — *mixed complexity: ordinary charting plus one bespoke widget*

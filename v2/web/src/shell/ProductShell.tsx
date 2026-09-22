import type { ReactNode } from "react";
import type { Workspace } from "../../../contracts/product-read";
import {
  Activity, BarChart3, Bot, ChevronRight, CircleHelp, ClipboardCheck, Database, FileQuestion,
  FileSearch, Gauge, GitCompareArrows, History, Layers3, Library, ListChecks, LogOut, Menu,
  Radar, RefreshCw, Search, Settings2, ShieldCheck, SlidersHorizontal, Sparkles, Target, X,
} from "lucide-react";
import { useState } from "react";

type Props = { path:string; workspace:Workspace|null; workspaceError:string|null; userEmail:string|null; onSwitch:()=>void; onLogout:()=>void; navigate:(to:string)=>void; children:ReactNode };
type NavigationItem = { to:string; label:string; icon:typeof Gauge };
const navigation: { label:string; items:NavigationItem[] }[] = [
  { label:"", items:[{to:"/overview",label:"总览",icon:Gauge}] },
  { label:"AI 监测", items:[
    {to:"/monitoring/insights",label:"游客提问分析",icon:Radar},
    {to:"/monitoring/questions",label:"游客问题管理",icon:FileQuestion},
    {to:"/monitoring/plans",label:"监测计划",icon:ListChecks},
    {to:"/monitoring/schedules",label:"周期监测",icon:Activity},
    {to:"/monitoring/channels",label:"采集渠道",icon:SlidersHorizontal},
    {to:"/monitoring/runs",label:"运行记录（含失败与费用）",icon:History},
  ]},
  { label:"数据分析", items:[
    {to:"/analysis/visibility",label:"AI 可见性",icon:Sparkles},
    {to:"/analysis/competitors",label:"竞争对手分析",icon:GitCompareArrows},
    {to:"/analysis/questions",label:"问题表现分析",icon:BarChart3},
    {to:"/analysis/platforms",label:"AI 平台比较",icon:Layers3},
    {to:"/analysis/sources",label:"引用与来源",icon:FileSearch},
    {to:"/analysis/history",label:"历史变化",icon:History},
  ]},
  { label:"证据", items:[
    {to:"/evidence/answers",label:"原始回答",icon:ShieldCheck},
    {to:"/evidence/sources",label:"引用来源",icon:FileSearch},
    {to:"/evidence/snapshots",label:"页面快照",icon:Database},
    {to:"/evidence/packages",label:"证据包",icon:Library},
  ]},
  { label:"闭环", items:[
    {to:"/decisions",label:"决策与行动",icon:ClipboardCheck},
    {to:"/remeasurement",label:"复测",icon:Target},
  ]},
  { label:"品牌真相", items:[
    {to:"/truth/facts",label:"品牌与服务事实",icon:ShieldCheck},
    {to:"/truth/aliases",label:"品牌名称与别名",icon:Settings2},
    {to:"/truth/competitors",label:"竞争范围",icon:GitCompareArrows},
    {to:"/truth/versions",label:"事实版本",icon:History},
  ]},
];

export function ProductShell({path,workspace,workspaceError,userEmail,onSwitch,onLogout,navigate,children}:Props) {
  const [mobileOpen,setMobileOpen]=useState(false);const[accountOpen,setAccountOpen]=useState(false);
  const go=(to:string)=>{navigate(to);setMobileOpen(false);};
  return <div className="gf-admin-v3"><a className="gf-skip-link" href="#main-content">跳到主要内容</a>
    <button className="mobile-menu" aria-label={mobileOpen?"关闭导航":"打开导航"} onClick={()=>setMobileOpen((value)=>!value)}>{mobileOpen?<X/>:<Menu/>}</button>
    {mobileOpen?<button className="sidebar-scrim" aria-label="关闭导航" onClick={()=>setMobileOpen(false)}/>:null}
    <aside className={`gf-sidebar ${mobileOpen?"is-open":""}`}>
      <div className="gf-sidebar__brand"><span className="gf-brand-mark">A</span><span className="gf-brand-copy"><strong>AnswerTravel</strong><small>GEO 决策与运营</small></span></div>
      <button className="workspace-switcher" onClick={onSwitch} title="切换品牌空间"><span><small>当前品牌空间</small><strong>{workspace?.brandName??"正在读取"}</strong></span><ChevronRight/></button>
      <nav className="gf-sidebar__nav" aria-label="主要导航">{navigation.map((group)=><div className="gf-sidebar__group" key={group.label||"overview"}>{group.label?<p className="gf-sidebar__heading">{group.label}</p>:null}<div className="gf-sidebar__items">{group.items.map((item)=>{const active=path===item.to||path.startsWith(`${item.to}/`);const Icon=item.icon;return <button key={item.to} className="gf-sidebar__link" aria-current={active?"page":undefined} onClick={()=>go(item.to)}><Icon/><span>{item.label}</span></button>})}</div></div>)}</nav>
      <div className="gf-account-wrap">{accountOpen?<div className="gf-account-menu"><button onClick={onSwitch}><RefreshCw/>切换品牌空间</button><button onClick={onLogout}><LogOut/>退出登录</button></div>:null}<button className="gf-sidebar__account" aria-expanded={accountOpen} onClick={()=>setAccountOpen(value=>!value)}><div className="gf-account-avatar">{workspace?.brandName.slice(0,1)??"A"}</div><div><strong>{workspace?.brandName??"当前品牌空间"}</strong><span>{workspaceError??userEmail??"只读工作台"}</span></div><ChevronRight/></button></div>
    </aside>
    <div className="gf-shell__body"><header className="gf-topbar"><div className="gf-topbar__identity"><Bot/><span>监测游客问题 · 分析信源竞对 · 决定优化方向</span></div><div className="gf-topbar__actions"><button className="gf-icon-button" title="搜索" aria-label="搜索（尚未开放）" disabled><Search/></button><button className="gf-icon-button" title="帮助" aria-label="帮助"><CircleHelp/></button><span className="readonly-badge">只读</span></div></header>
      <main id="main-content" className="gf-content" tabIndex={-1}>{children}</main><footer className="source-footer">AnswerTravel 产品前端基于 GEOFlow 固定版本的设计系统改造 · <a href="/UPSTREAM.md" target="_blank" rel="noreferrer">上游说明</a> · <a href="/AGPL-3.0.txt" target="_blank" rel="noreferrer">AGPL-3.0 许可证</a> · <a href="/answertravel-v2-frontend-source.tar.gz">对应源码</a></footer></div>
  </div>;
}

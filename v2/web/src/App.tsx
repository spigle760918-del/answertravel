import { useEffect, useState } from "react";
import { workspaceSchema, type Workspace } from "../../contracts/product-read";
import { authSessionSchema, type AuthSession } from "../../contracts/auth";
import { ApiError, getJson, postEmpty } from "./api";
import { LoginPage, NoPermissionPage, WorkspaceSelectionPage } from "./auth-pages";
import { AnswerPage, NotFoundPage, OverviewPage, PlanDetailPage, QuestionsPage } from "./pages";
import { CapabilityPage } from "./capability-page";
import { QuestionInsightsPage } from "./question-insights-page";
import { RunsPage } from "./runs-page";
import { MonitoringPlansPage } from "./monitoring-plans-page";
import { QuestionPerformancePage } from "./question-performance-page";
import { AiVisibilityPage, SourceAnalysisPage } from "./analysis-evidence-pages";
import { CompetitorScopePage } from "./competitor-scope-page";
import { CompetitorAnalysisPage } from "./competitor-analysis-page";
import { ProductShell } from "./shell/ProductShell";

const currentPath = () => window.location.pathname === "/" ? "/overview" : window.location.pathname.replace(/\/$/, "");

export default function App() {
  const [path, setPath] = useState(currentPath);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [session,setSession]=useState<AuthSession|null>(null);
  const [access,setAccess]=useState<"loading"|"login"|"expired"|"select"|"forbidden"|"ready">("loading");
  useEffect(() => {
    const onPopState = () => setPath(currentPath());
    const onUnauthorized=()=>{setSession(null);setWorkspace(null);setAccess("expired")};
    window.addEventListener("popstate", onPopState);
    window.addEventListener("answertravel:unauthorized",onUnauthorized);
    void getJson("/api/v1/auth/session",authSessionSchema).then(value=>{setSession(value);setAccess(value.requiresWorkspaceSelection?"select":"ready")}).catch((error:Error)=>setAccess(error instanceof ApiError&&error.status===403?"forbidden":"login"));
    return () => {window.removeEventListener("popstate", onPopState);window.removeEventListener("answertravel:unauthorized",onUnauthorized)};
  }, []);
  useEffect(()=>{if(access!=="ready")return;setWorkspace(null);setWorkspaceError(null);void getJson("/api/v1/workspace",workspaceSchema).then(setWorkspace).catch((error:Error)=>{setWorkspaceError(error.message);if(error instanceof ApiError&&error.status===403)setAccess("forbidden")});},[access,session?.selectedTenantId]);
  const navigate = (to: string) => { if (to === path) return; window.history.pushState(null, "", to); setPath(to); window.scrollTo({ top: 0, behavior: "instant" }); };
  const planMatch = path.match(/^\/monitoring\/runs\/([^/]+)$/);
  const insightMatch = path.match(/^\/monitoring\/insights\/([^/]+)$/);
  const answerMatch = path.match(/^\/evidence\/answers\/([^/]+)$/);
  const page = path === "/overview" ? <OverviewPage navigate={navigate} />
    : path === "/monitoring/insights" ? <QuestionInsightsPage navigate={navigate} />
    : insightMatch?.[1] ? <QuestionInsightsPage key={insightMatch[1]} initialQuestionId={insightMatch[1]} navigate={navigate}/>
    : path === "/monitoring/questions" ? <QuestionsPage navigate={navigate} />
    : path === "/monitoring/plans" ? <MonitoringPlansPage navigate={navigate} />
    : path === "/monitoring/runs" ? <RunsPage navigate={navigate} />
    : path === "/analysis/questions" ? <QuestionPerformancePage navigate={navigate}/>
    : path === "/analysis/visibility" ? <AiVisibilityPage navigate={navigate}/>
    : path === "/analysis/sources" ? <SourceAnalysisPage navigate={navigate}/>
    : path === "/truth/competitors" ? <CompetitorScopePage/>
    : path === "/analysis/competitors" ? <CompetitorAnalysisPage/>
    : planMatch?.[1] ? <PlanDetailPage planId={planMatch[1]} navigate={navigate} />
    : answerMatch?.[1] ? <AnswerPage answerId={answerMatch[1]} navigate={navigate} />
    : ["/monitoring/schedules","/monitoring/channels","/analysis/platforms","/analysis/history","/evidence/answers","/evidence/sources","/evidence/snapshots","/evidence/packages","/decisions","/remeasurement","/truth/facts","/truth/aliases","/truth/versions"].includes(path)
      ? <CapabilityPage path={path} navigate={navigate}/> : <NotFoundPage navigate={navigate} />;
  const accepted=(value:AuthSession)=>{setSession(value);setWorkspace(null);setAccess(value.requiresWorkspaceSelection?"select":"ready")};
  if(access==="loading")return <div className="access-loading-page">正在确认访问权限...</div>;
  if(access==="login"||access==="expired")return <LoginPage expired={access==="expired"} onLogin={accepted}/>;
  if(access==="select")return <WorkspaceSelectionPage onSelected={accepted}/>;
  if(access==="forbidden")return <NoPermissionPage/>;
  return <ProductShell path={path} workspace={workspace} workspaceError={workspaceError} userEmail={session?.user.email??null} onSwitch={()=>{setWorkspace(null);setWorkspaceError(null);setAccess("select")}} onLogout={async()=>{await postEmpty("/api/v1/auth/logout").catch(()=>undefined);setSession(null);setWorkspace(null);setAccess("login")}} navigate={navigate}>{page}</ProductShell>;
}

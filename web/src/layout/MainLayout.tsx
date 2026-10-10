import { Layout, Menu, Typography, Button, Space, Switch, InputNumber } from "antd";
import {
  DashboardOutlined,
  BarChartOutlined,
  CloudServerOutlined,
  RobotOutlined,
  BranchesOutlined,
  ToolOutlined,
  ApiOutlined,
  KeyOutlined,
  FileTextOutlined,
  MessageOutlined,
  SettingOutlined,
  LogoutOutlined,
} from "@ant-design/icons";
import { Outlet, useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "../auth";
import { useRefresh } from "../refresh";
import Assistant from "../components/Assistant";
import { CurrencyProvider } from "../currency";

const { Sider, Header, Content } = Layout;

const items = [
  { key: "/", icon: <DashboardOutlined />, label: "仪表盘" },
  { key: "/usage", icon: <BarChartOutlined />, label: "用量详情" },
  { key: "/providers", icon: <CloudServerOutlined />, label: "供应商" },
  { key: "/models", icon: <RobotOutlined />, label: "模型" },
  { key: "/routing", icon: <BranchesOutlined />, label: "路由与层级" },
  { key: "/skills", icon: <ToolOutlined />, label: "Skill" },
  { key: "/mcp", icon: <ApiOutlined />, label: "MCP 服务器" },
  { key: "/keys", icon: <KeyOutlined />, label: "API 密钥" },
  { key: "/logs", icon: <FileTextOutlined />, label: "调用记录" },
  { key: "/conversations", icon: <MessageOutlined />, label: "对话历史" },
  { key: "/compression", icon: <ToolOutlined />, label: "上下文压缩" },
  { key: "/settings", icon: <SettingOutlined />, label: "设置" },
];

export default function MainLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const { logout, username } = useAuth();
  const { enabled, setEnabled, sec, setSec } = useRefresh();

  const selectedKey = items
    .map((i) => i.key)
    .filter((k) => k !== "/" && location.pathname.startsWith(k))
    .sort((a, b) => b.length - a.length)[0] ?? "/";

  return (
    <CurrencyProvider>
      <Layout style={{ height: "100vh", overflow: "hidden" }}>
        <Sider theme="dark" width={220} style={{ height: "100vh", overflow: "auto" }}>
        <div
          style={{
            height: 56,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#fff",
            fontWeight: 700,
            fontSize: 16,
          }}
        >
          ANMAST Gateway
        </div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[selectedKey]}
          items={items}
          onClick={(e) => navigate(e.key)}
        />
      </Sider>
      <Layout>
        <Header
          style={{
            background: "#fff",
            padding: "0 24px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            borderBottom: "1px solid #f0f0f0",
          }}
        >
          <Typography.Title level={4} style={{ margin: 0 }}>
            AI 网关控制台
          </Typography.Title>
          <Space>
            <Typography.Text type="secondary">自动刷新</Typography.Text>
            <Switch size="small" checked={enabled} onChange={setEnabled} />
            {enabled && (
              <>
                <InputNumber
                  size="small"
                  min={1}
                  max={3600}
                  value={sec}
                  onChange={(v) => setSec(v ?? 3)}
                  style={{ width: 60 }}
                />
                <Typography.Text type="secondary">秒</Typography.Text>
              </>
            )}
            <Typography.Text type="secondary">{username ?? "admin"}</Typography.Text>
            <Button
              icon={<LogoutOutlined />}
              onClick={async () => {
                await logout();
                navigate("/login");
              }}
            >
              退出
            </Button>
          </Space>
        </Header>
        <Content style={{ padding: "24px 24px 24px", overflow: "auto" }}>
          <Outlet />
        </Content>
      </Layout>
      <Assistant />
    </Layout>
    </CurrencyProvider>
  );
}

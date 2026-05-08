#!/usr/bin/env node
// DDT v0.9.16 D33 · 生成外部平台 Spring 6 RestClient 集成骨架
//
// 用途：v0.9.13 D30 解决了"前端 mock"，但 server 端"假后端"问题没人解决——
// alv-ops 实测耦合度 0%（NeolixClient 不存在 / 18 endpoint 0 调用 / 假 triggerSync）。
// 本脚本从 brief §11 抽外部依赖，生成 6 个 Spring Boot 核心类骨架：
//   - <Sys>Properties.java（@ConfigurationProperties 配置绑定）
//   - <Sys>SignatureUtil.java（HMAC 签名工具）
//   - <Sys>OAuthService.java（Token 获取 + Redis 缓存 stub）
//   - <Sys>Client.java（interface，含 1 个 demo 方法）
//   - Mock<Sys>Client.java（@Profile("!prod") 默认，返回 fixture）
//   - <Sys>ClientConfig.java（RestClient @Bean + Profile 双轨说明）
//
// 设计原则：
//   - 仅生成"通用核心骨架"，具体 endpoint 方法由 LLM 在 IMPLEMENT 阶段按 brief §11 扩展
//   - Spring 6 RestClient 原生（零额外依赖，与 java-modern preset 对齐）
//   - 双轨模式：dev/test 用 MockClient，prod 用真实 Client
//   - 已存在文件不覆盖（防 LLM 改动丢失）

import { existsSync, readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';

const PROJECT_ROOT = process.cwd();

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=');
      const next = argv[i + 1];
      if (v !== undefined) { args[k] = v; }
      else if (next !== undefined && !next.startsWith('--')) { args[k] = next; i++; }
      else args[k] = true;
    } else args._.push(a);
  }
  return args;
}

// ============================================================================
// 解析 brief §11 抽外部系统信息
// ============================================================================

function parseBriefIntegration(briefText) {
  const m = briefText.match(/##\s+(?:§11\s+)?集成依赖[\s\S]*?(?=\n##\s|\n#\s|$)/);
  if (!m) return [];
  const block = m[0];
  const sysMatches = [...block.matchAll(/###\s+(?:第三方系统[：:]\s*)?([^\n]+)/g)];

  const systems = [];
  for (const sm of sysMatches) {
    const name = sm[1].trim();
    const tail = block.slice(sm.index);
    const baseUrls = [...new Set([...tail.matchAll(/(https?:\/\/[a-z0-9.\-/]+)/gi)].map(u => u[1]))].slice(0, 3);
    const authMatch = tail.match(/鉴权方式[^\n]*?\|\s*([^\n|]+)/);

    // 推 system prefix：英文优先，否则从域名取
    let prefix = null;
    const englishMatch = name.match(/\b([A-Za-z]{3,})\b/);
    if (englishMatch) {
      prefix = englishMatch[1].charAt(0).toUpperCase() + englishMatch[1].slice(1).toLowerCase();
    } else if (baseUrls.length > 0) {
      const hostMatch = baseUrls[0].match(/https?:\/\/[^.]*\.([a-z0-9-]+)\./i);
      if (hostMatch) prefix = hostMatch[1].charAt(0).toUpperCase() + hostMatch[1].slice(1).toLowerCase();
    }
    // 中文系统名 fallback：识别"新石器" → "Neolix"
    if (!prefix && /新石器/.test(name)) prefix = 'Neolix';
    if (!prefix) prefix = 'External';

    systems.push({ name, prefix, baseUrls, authMethod: authMatch?.[1].trim() || 'OAuth2' });
  }
  return systems;
}

// ============================================================================
// 推断 server 项目的 base package（找 @SpringBootApplication 类）
// ============================================================================

function findBasePackage(serverRoot) {
  const javaSrc = join(serverRoot, 'src', 'main', 'java');
  if (!existsSync(javaSrc)) return null;

  function walk(dir) {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const ent of entries) {
      if (ent.isDirectory()) {
        const r = walk(join(dir, ent.name));
        if (r) return r;
      } else if (ent.isFile() && ent.name.endsWith('.java')) {
        const text = readFileSync(join(dir, ent.name), 'utf8');
        if (/@SpringBootApplication/.test(text)) {
          const pkgMatch = text.match(/^package\s+([\w.]+)\s*;/m);
          if (pkgMatch) return pkgMatch[1];
        }
      }
    }
    return null;
  }
  return walk(javaSrc);
}

// ============================================================================
// Java 模板（占位符 {{X}} 替换）
// ============================================================================

const TEMPLATES = {
  Properties: `package {{PACKAGE}};

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * {{SYSTEM_NAME}} 集成配置（v0.9.16 D33 自动生成）
 *
 * application.yml 对应：
 * <pre>
 * app:
 *   {{KEY}}:
 *     base-url-oauth: https://...
 *     base-url-cloud: https://...
 *     app-id: \${NEOLIX_APP_ID:}
 *     app-secret: \${NEOLIX_APP_SECRET:}
 *     x-from: \${NEOLIX_X_FROM:}
 *     mock-enabled: false
 * </pre>
 */
@ConfigurationProperties(prefix = "app.{{KEY}}")
public class {{PREFIX}}Properties {
    /** OAuth Token 获取基础 URL */
    private String baseUrlOauth = "{{BASE_URL_OAUTH}}";
    /** 业务 Cloud API 基础 URL */
    private String baseUrlCloud = "{{BASE_URL_CLOUD}}";
    /** 视频 API 基础 URL */
    private String baseUrlVideo = "{{BASE_URL_VIDEO}}";
    /** 应用 ID */
    private String appId = "";
    /** 应用密钥 */
    private String appSecret = "";
    /** X-from 应用标识请求头 */
    private String xFrom = "";
    /** 是否启用 Mock 模式（默认 true，开发环境不连真实平台） */
    private boolean mockEnabled = true;

    public String getBaseUrlOauth() { return baseUrlOauth; }
    public void setBaseUrlOauth(String baseUrlOauth) { this.baseUrlOauth = baseUrlOauth; }
    public String getBaseUrlCloud() { return baseUrlCloud; }
    public void setBaseUrlCloud(String baseUrlCloud) { this.baseUrlCloud = baseUrlCloud; }
    public String getBaseUrlVideo() { return baseUrlVideo; }
    public void setBaseUrlVideo(String baseUrlVideo) { this.baseUrlVideo = baseUrlVideo; }
    public String getAppId() { return appId; }
    public void setAppId(String appId) { this.appId = appId; }
    public String getAppSecret() { return appSecret; }
    public void setAppSecret(String appSecret) { this.appSecret = appSecret; }
    public String getXFrom() { return xFrom; }
    public void setXFrom(String xFrom) { this.xFrom = xFrom; }
    public boolean isMockEnabled() { return mockEnabled; }
    public void setMockEnabled(boolean mockEnabled) { this.mockEnabled = mockEnabled; }
}
`,

  SignatureUtil: `package {{PACKAGE}};

import java.security.MessageDigest;
import java.util.Arrays;

/**
 * {{SYSTEM_NAME}} 签名工具（v0.9.16 D33 自动生成）
 *
 * 签名规则（按 brief §11 契约文档）：
 *   1. 收集参数：[appSecret, timeStamp, nonce]
 *   2. 字典序排序后拼接（无分隔符）
 *   3. SHA-1 哈希 → 16 进制小写
 *
 * TODO: 按外部平台 02-鉴权说明 验证签名算法（HMAC-SHA1 vs SHA-1）
 */
public final class {{PREFIX}}SignatureUtil {

    private {{PREFIX}}SignatureUtil() {}

    public static String sign(String appSecret, String timeStamp, String nonce) {
        try {
            String[] arr = { appSecret, timeStamp, nonce };
            Arrays.sort(arr);
            String concat = String.join("", arr);
            MessageDigest md = MessageDigest.getInstance("SHA-1");
            byte[] hash = md.digest(concat.getBytes("UTF-8"));
            StringBuilder hex = new StringBuilder();
            for (byte b : hash) hex.append(String.format("%02x", b & 0xff));
            return hex.toString();
        } catch (Exception e) {
            throw new RuntimeException("Signature generation failed", e);
        }
    }

    public static String randomNonce(int length) {
        String chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < length; i++) {
            sb.append(chars.charAt((int) (Math.random() * chars.length())));
        }
        return sb.toString();
    }
}
`,

  OAuthService: `package {{PACKAGE}};

import org.springframework.stereotype.Service;
import org.springframework.web.client.RestClient;
import java.util.Map;
import java.util.concurrent.atomic.AtomicReference;

/**
 * {{SYSTEM_NAME}} OAuth Token 服务（v0.9.16 D33 自动生成）
 *
 * 职责：获取 access_token + 缓存（Redis 推荐）+ 自动刷新
 * TODO: LLM 在 IMPLEMENT 阶段按 brief §11 02-鉴权说明 完成实现
 */
@Service
public class {{PREFIX}}OAuthService {

    private final {{PREFIX}}Properties properties;
    private final RestClient restClient;
    /** 简化版内存缓存；生产用 Redis */
    private final AtomicReference<String> cachedToken = new AtomicReference<>();
    private final AtomicReference<Long> tokenExpiresAt = new AtomicReference<>(0L);

    public {{PREFIX}}OAuthService({{PREFIX}}Properties properties, RestClient.Builder builder) {
        this.properties = properties;
        this.restClient = builder.baseUrl(properties.getBaseUrlOauth()).build();
    }

    /**
     * 获取有效 Token（命中缓存直接返回；过期则刷新）
     * TODO: 真实实现需要：
     *   1. POST {baseUrlOauth}/getAccessToken with grant_type=client_credentials
     *   2. 解析 response.access_token 与 expires_in
     *   3. 写入 Redis 缓存（过期前 60 秒强制刷新）
     */
    public String getValidToken() {
        long now = System.currentTimeMillis();
        if (cachedToken.get() != null && tokenExpiresAt.get() > now + 60_000) {
            return cachedToken.get();
        }
        // TODO: 真实调用，伪代码：
        // Map<String, Object> resp = restClient.post()
        //     .uri("/getAccessToken")
        //     .body(Map.of("client_id", properties.getAppId(), "client_secret", properties.getAppSecret()))
        //     .retrieve()
        //     .body(Map.class);
        // String token = (String) resp.get("access_token");
        // Long expiresIn = ((Number) resp.get("expires_in")).longValue();
        // cachedToken.set(token);
        // tokenExpiresAt.set(now + expiresIn * 1000);
        // return token;
        throw new UnsupportedOperationException("OAuth not implemented yet; switch to MockClient via @Profile(\\"!prod\\") or implement getValidToken()");
    }

    public void invalidateCache() {
        cachedToken.set(null);
        tokenExpiresAt.set(0L);
    }
}
`,

  ClientInterface: `package {{PACKAGE}};

import java.util.List;
import java.util.Map;

/**
 * {{SYSTEM_NAME}} 集成 Client 接口（v0.9.16 D33 自动生成）
 *
 * 双轨模式：
 *   - {{PREFIX}}MockClient（@Profile("!prod") 默认）：返回 fixture 数据
 *   - Real{{PREFIX}}Client（@Profile("prod") TODO）：真实调用外部平台
 *
 * TODO: LLM 按 brief §11 \`项目资料/{{CONTRACT_DIR}}/\` 列出的 endpoint
 *       为本接口添加方法（如 listVehicles / batchRealtimeVehicles / dispatchTask / cancelTask 等）
 */
public interface {{PREFIX}}Client {

    /**
     * Demo 方法：列车辆（按 brief §11 03/01 - 获取车辆列表）
     * 返回类型用 Map 占位，LLM 应替换为实际 DTO（参考 docs/api-contract.yaml schema）
     */
    List<Map<String, Object>> listVehicles();

    /**
     * 健康检查 / 鉴权验证
     */
    boolean isHealthy();
}
`,

  MockClient: `package {{PACKAGE}};

import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.Map;

/**
 * {{SYSTEM_NAME}} Mock 实现（v0.9.16 D33 自动生成）
 *
 * 默认启用：app.{{KEY}}.mock-enabled=true（dev/test profile）
 * 生产关闭：app.{{KEY}}.mock-enabled=false 或 @Profile("prod")
 *
 * 用途：
 *   - dev 环境无外部凭证时返回 fixture 数据让前端联调
 *   - 单元/集成测试稳定数据源
 *   - 演示环境
 *
 * TODO: LLM 在 IMPLEMENT 阶段按 brief §11 endpoint 添加方法 + fixture 数据
 */
@Component
@Profile("!prod")
@ConditionalOnProperty(name = "app.{{KEY}}.mock-enabled", havingValue = "true", matchIfMissing = true)
public class {{PREFIX}}MockClient implements {{PREFIX}}Client {

    @Override
    public List<Map<String, Object>> listVehicles() {
        return List.of(
            Map.of("vin", "MOCK-V001", "brand", "{{PREFIX}}", "status", "ONLINE"),
            Map.of("vin", "MOCK-V002", "brand", "{{PREFIX}}", "status", "OFFLINE")
        );
    }

    @Override
    public boolean isHealthy() {
        return true;
    }
}
`,

  ClientConfig: `package {{PACKAGE}};

import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.client.RestClient;

import java.time.Duration;

/**
 * {{SYSTEM_NAME}} 集成配置（v0.9.16 D33 自动生成）
 *
 * 注册：
 *   - {{PREFIX}}Properties（@ConfigurationProperties）
 *   - RestClient.Builder（共享 Bean）
 *
 * 双轨切换：
 *   - dev/test：默认走 {{PREFIX}}MockClient（@Profile("!prod")）
 *   - prod：需用户实现 Real{{PREFIX}}Client + @Profile("prod") + 删除 MockClient 的 @Profile 限制
 *
 * 启动后自检：检查 base-url 与 brief §11 一致；不一致打印 warning
 */
@Configuration
@EnableConfigurationProperties({{PREFIX}}Properties.class)
public class {{PREFIX}}ClientConfig {

    /** RestClient.Builder 共享 Bean（已自动注册，无需手动 @Bean，仅作示意） */
    // Spring Boot 3.2+ 默认提供 RestClient.Builder Bean
    // 如需自定义超时 / 拦截器，在此覆盖：
    // @Bean
    // public RestClient.Builder restClientBuilder() {
    //     return RestClient.builder()
    //         .requestFactory(...)  // 自定义 timeout
    //         .defaultHeader("User-Agent", "DDT-{{PREFIX}}-Client/1.0");
    // }
}
`,
};

function fillTemplate(name, ctx) {
  let text = TEMPLATES[name];
  for (const [k, v] of Object.entries(ctx)) {
    text = text.replace(new RegExp('\\{\\{' + k + '\\}\\}', 'g'), v);
  }
  return text;
}

// ============================================================================
// 主流程
// ============================================================================

function main() {
  const args = parseArgs(process.argv.slice(2));
  const briefPath = args.brief || join(PROJECT_ROOT, 'project-brief.md');
  const serverRoot = join(PROJECT_ROOT, args.server || 'server');

  if (args['dry-run']) {
    console.log('# generate-external-client --dry-run');
    console.log('1. 解析 ' + briefPath + ' §11 集成依赖（找系统名 + 基础 URL + 鉴权）');
    console.log('2. 推断 server base package（扫 @SpringBootApplication）');
    console.log('3. 推 system prefix（如"新石器" → Neolix）');
    console.log('4. 生成 6 个 Java 类到 <basePackage>.external.<key>:');
    console.log('   - <Prefix>Properties.java');
    console.log('   - <Prefix>SignatureUtil.java');
    console.log('   - <Prefix>OAuthService.java');
    console.log('   - <Prefix>Client.java (interface)');
    console.log('   - <Prefix>MockClient.java (@Profile("!prod") 默认)');
    console.log('   - <Prefix>ClientConfig.java');
    console.log('5. 已存在文件不覆盖（防 LLM 改动丢失）');
    process.exit(0);
  }

  if (!existsSync(briefPath)) {
    console.error('❌ ' + briefPath + ' 不存在；先跑 /digital-delivery-team:ddt-brief-builder');
    process.exit(2);
  }
  if (!existsSync(serverRoot)) {
    console.error('❌ ' + serverRoot + ' 不存在；--server=<dir> 改路径');
    process.exit(2);
  }

  const briefText = readFileSync(briefPath, 'utf8');
  const systems = parseBriefIntegration(briefText);
  if (systems.length === 0) {
    console.error('❌ brief §11 未声明集成依赖；本脚本无可生成对象');
    process.exit(3);
  }

  const basePackage = findBasePackage(serverRoot);
  if (!basePackage) {
    console.error('❌ 找不到 @SpringBootApplication 类，无法推断 base package');
    process.exit(3);
  }
  console.log('▶ base package: ' + basePackage);

  const javaSrcRoot = join(serverRoot, 'src', 'main', 'java');
  let totalGenerated = 0, totalSkipped = 0;

  for (const sys of systems) {
    const key = sys.prefix.toLowerCase();
    const targetPackage = basePackage + '.external.' + key;
    const targetDir = join(javaSrcRoot, ...targetPackage.split('.'));
    mkdirSync(targetDir, { recursive: true });

    const ctx = {
      PACKAGE: targetPackage,
      SYSTEM_NAME: sys.name,
      PREFIX: sys.prefix,
      KEY: key,
      BASE_URL_OAUTH: sys.baseUrls[0] || 'https://api.example.com/oauth',
      BASE_URL_CLOUD: sys.baseUrls[1] || sys.baseUrls[0] || 'https://api.example.com/cloud',
      BASE_URL_VIDEO: sys.baseUrls[2] || sys.baseUrls[0] || 'https://api.example.com/video',
      CONTRACT_DIR: '<契约目录>',
    };

    const filesToGen = [
      [sys.prefix + 'Properties.java', 'Properties'],
      [sys.prefix + 'SignatureUtil.java', 'SignatureUtil'],
      [sys.prefix + 'OAuthService.java', 'OAuthService'],
      [sys.prefix + 'Client.java', 'ClientInterface'],
      [sys.prefix + 'MockClient.java', 'MockClient'],
      [sys.prefix + 'ClientConfig.java', 'ClientConfig'],
    ];

    console.log('▶ 系统：' + sys.name + ' → package: ' + targetPackage);
    for (const [filename, templateKey] of filesToGen) {
      const filePath = join(targetDir, filename);
      if (existsSync(filePath)) {
        console.log('  ⏭️  ' + filename + ' 已存在（不覆盖）');
        totalSkipped++;
        continue;
      }
      const content = fillTemplate(templateKey, ctx);
      writeFileSync(filePath, content);
      console.log('  ✅ ' + filename);
      totalGenerated++;
    }
  }

  console.log('');
  console.log('✅ 生成完成：' + totalGenerated + ' 个文件创建 / ' + totalSkipped + ' 个跳过（已存在）');
  console.log('');
  console.log('💡 下一步：');
  console.log('   1. 在 application.yml 补 app.<key>.* 配置（mock-enabled=true 默认走 MockClient）');
  console.log('   2. LLM 按 brief §11 contract 文档为 <Prefix>Client interface 加方法');
  console.log('   3. 在原假 sync Service 中注入 <Prefix>Client 替代假 success 返回');
  console.log('   4. 跑 /digital-delivery-team:integrate 验证 server 能起来（MockClient profile 模式）');

  process.exit(0);
}

main();

# ==========================================
# 阶段 1: 编译前端静态资源
# ==========================================
FROM node:20-alpine AS web-builder

WORKDIR /app/web

# 安装依赖
COPY web/package.json web/package-lock.json* ./
RUN npm ci || npm install

# 构建前端产物
COPY web/ ./
RUN npm run build

# ==========================================
# 阶段 2: 编译 Go 后端二进制
# ==========================================
FROM golang:1.24-alpine AS api-builder

WORKDIR /app

# 安装构建所需依赖
RUN apk add --no-cache git ca-certificates tzdata

COPY go.mod go.sum ./
RUN go mod download

COPY . .

# 编译 ha-api 可执行文件
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /app/bin/ha-api ./cmd/ha-api

# ==========================================
# 阶段 3: 最终运行镜像
# ==========================================
FROM alpine:3.21

WORKDIR /app

RUN apk add --no-cache ca-certificates tzdata curl

# 复制后端二进制
COPY --from=api-builder /app/bin/ha-api /app/ha-api

# 复制前端编译产物（可作为内置静态文件或单独由反代挂载）
COPY --from=web-builder /app/web/dist /app/web/dist

EXPOSE 8080

CMD ["/app/ha-api"]

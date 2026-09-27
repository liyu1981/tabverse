# Build stage: CGO disabled on purpose, the SQLite driver is pure Go.
FROM golang:1.24-alpine AS build
ARG VERSION=dev
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -trimpath \
      -ldflags "-s -w -X github.com/liyu1981/tabverse/server/internal/version.Version=${VERSION}" \
      -o /out/tabversed ./cmd/tabversed

FROM alpine:3.20
RUN adduser -D -H app && apk add --no-cache ca-certificates tzdata
COPY --from=build /out/tabversed /usr/local/bin/tabversed
USER app
VOLUME /data
ENV TABVERSED_ADDR=:8080 \
    TABVERSED_DB=/data/tabversed.db
EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/tabversed"]

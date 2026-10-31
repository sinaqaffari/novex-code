# syntax=docker/dockerfile:1
FROM golang:1.25-bookworm AS build
WORKDIR /src
COPY backend/go.mod backend/go.sum ./
RUN go mod download
COPY backend/ ./
RUN CGO_ENABLED=0 go build -trimpath -ldflags='-s -w' -o /out/novex-backend ./cmd/novex

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /out/novex-backend /novex-backend
USER nonroot:nonroot
EXPOSE 8080
ENTRYPOINT ["/novex-backend"]

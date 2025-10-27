FROM node:25.0-bookworm-slim
ARG TARGETPLATFORM
COPY $TARGETPLATFORM/dashica-server /usr/bin/
STOPSIGNAL SIGINT
ENTRYPOINT ["/usr/bin/dashica-server"]
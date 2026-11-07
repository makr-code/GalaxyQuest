FROM themisdb/themisdb:develop

ENV LD_LIBRARY_PATH=/src/build-gcc-linux-release/lib

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        libgomp1 \
        libnuma1 \
        libtbb12 \
        libspdlog1.12 \
        libfmt9 \
        libboost-system1.83.0 \
        libyaml-cpp0.8 \
        libpugixml1v5 \
        libmimalloc2.0 \
    && rm -rf /var/lib/apt/lists/*

RUN groupadd --system --gid 10001 themisdb \
    && useradd --system --uid 10001 --gid themisdb --no-create-home --home-dir /data --shell /usr/sbin/nologin themisdb \
    && install -d --owner=themisdb --group=themisdb --mode=0750 /data

USER themisdb
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
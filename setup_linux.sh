#! /bin/bash

cp yq_linux_amd64 /usr/local/bin/yq
chmod +x /usr/local/bin/yq
#chmod -x $(pwd)/devAgentBatch.sh
#echo "alias devAgentBatch='bash $(pwd)/devAgentBatch.sh'" >> ~/.bashrc
#echo "安装完成！"
#echo "请重新登录"
# 2. 创建 devAgentBatch 可执行文件
tee /usr/local/bin/devAgentBatch > /dev/null << EOF
#!/bin/bash
$(pwd)/devAgentBatch.sh "\$@"
EOF

# 3. 给 devAgentBatch 添加执行权限
chmod +x /usr/local/bin/devAgentBatch

# 4. 给原始脚本添加执行权限（如果需要）
chmod +x $(pwd)/devAgentBatch.sh

echo "安装完成！"
echo "请重新登录"
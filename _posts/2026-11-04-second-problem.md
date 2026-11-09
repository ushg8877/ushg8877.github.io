---
title: 第二题
date: 2026-11-04 08:50:07+08:00
tags: []
published: true
access_id: c08a6bcf699a60c8cae7ede7a9ce8fa0
updated_at: '2026-11-04T18:57:29+08:00'
first_published_at: '2026-11-04T08:51:33+08:00'
---
这是测试算法竞赛功能。

这个题很简单，编写函数

```cpp
int add(int x,int y);
```

返回 $x+y$。下发文件有 grader.cpp 用于求出验证码。

**你需要在本地运行你的程序！**

grader 会首先检验你的答案哈希是否正确，在正确时会使用加密算法获得本题的密钥。

数据范围：

- $1\leq T\leq 5\times 10^7$；
- $0\leq x,y\leq 10^9$。

grader はこちら：[grader.cpp](/assets/downloads/second-problem/grader.cpp)（[完整下发包](/assets/downloads/second-problem/add-grader.zip)）。

将 `grader.cpp` 与自己的 `solution.cpp` 一起编译：

```bash
g++ -O2 -std=c++17 grader.cpp solution.cpp -o grader
```

运行后，将输出的验证码填入网页。

<span class="sealed-block sealed-inline" data-sealed="eyJjaXBoZXJ0ZXh0IjoiWmxMV1pKdG9BOG5mMjJfNnE5b0hCM2dDSTlBY3JvREs5SXVHeFBZYUo2NEhQNERtdFNMTnJYanpLaU82cXN5STl3SXFXVGlWcE8yeWN4bGhFMjg3VlVxUTdKQktrT3RpZlU0SEJQOCIsImVwb2NoIjoiZjZjMjhhMDBkMjYxMmIzNDdhYzBjMjAwODNjMTJmZTAiLCJpdiI6Ilo0NnNUZDAtRlppVEJPbjEiLCJ2IjoxfQ"><span class="sealed-placeholder" data-chars="6" data-images="0">此处内容需验证码解锁</span></span>